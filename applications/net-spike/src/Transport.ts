import { Effect, Option, Queue, type Scope, Stream } from 'effect';

/**
 * A connection between a client and a server, by the guarantee a message needs rather than by the technology carrying it. It is shaped after WebTransport: a reliable channel that never loses or reorders, and an unreliable one that may. Where only a WebSocket is available, both channels travel through it and the unreliable one simply never loses anything, which a protocol written for loss does not mind.
 */

export type Channel = 'reliable' | 'unreliable';

export interface Frame {
  readonly channel: Channel;
  readonly payload: string;
}

export interface Connection {
  readonly send: (frame: Frame) => Effect.Effect<void>;
  readonly frames: Stream.Stream<Frame>;
}

// Over a single text stream, such as a WebSocket, the first character names the channel.

const channelMarks: Record<Channel, string> = { reliable: 'R', unreliable: 'U' };

export const encodeFrame = (frame: Frame): string => channelMarks[frame.channel] + frame.payload;

export const decodeFrame = (text: string): Option.Option<Frame> => {
  const payload = text.slice(1);
  switch (text[0]) {
    case channelMarks.reliable:
      return Option.some({ channel: 'reliable', payload });
    case channelMarks.unreliable:
      return Option.some({ channel: 'unreliable', payload });
    default:
      return Option.none();
  }
};

/** Two connected ends in memory, for tests and for a server running in the same process. */
export const memoryPair: Effect.Effect<readonly [Connection, Connection]> = Effect.gen(
  function* () {
    const toFirst = yield* Queue.unbounded<Frame>();
    const toSecond = yield* Queue.unbounded<Frame>();
    const end = (inbox: Queue.Queue<Frame>, outbox: Queue.Queue<Frame>): Connection => ({
      send: (frame) => Queue.offer(outbox, frame).pipe(Effect.asVoid),
      frames: Stream.fromQueue(inbox),
    });
    return [end(toFirst, toSecond), end(toSecond, toFirst)] as const;
  },
);

export interface Conditions {
  readonly latencyMillis: number;
  /** The share of unreliable frames lost, from 0 to 1. */
  readonly loss: number;
  /** Decides which frames are lost; pass a seeded source to make a run repeatable. */
  readonly random: () => number;
}

/**
 * A connection whose outgoing frames meet the given network conditions: delayed by the latency, and unreliable ones lost at the loss rate. Wrap both ends to condition both directions. The delays run in the enclosing scope.
 */
export const withConditions = (
  connection: Connection,
  conditions: Conditions,
): Effect.Effect<Connection, never, Scope.Scope> =>
  Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const deliver = (frame: Frame) =>
      conditions.latencyMillis === 0
        ? connection.send(frame)
        : connection
            .send(frame)
            .pipe(
              Effect.delay(`${conditions.latencyMillis} millis`),
              Effect.forkIn(scope),
              Effect.asVoid,
            );
    return {
      send: (frame) =>
        Effect.suspend(() =>
          frame.channel === 'unreliable' && conditions.random() < conditions.loss
            ? Effect.void
            : deliver(frame),
        ),
      frames: connection.frames,
    };
  });
