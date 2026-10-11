import { describe, expect, it } from '@effect/vitest';
import { type Cause, Effect, Option, Queue, Stream } from 'effect';
import * as Socket from 'effect/socket/Socket';
import * as SocketTransport from '#src/SocketTransport.ts';

/** Two sockets in memory, each reading what the other writes, as the two ends of a WebSocket do; closing one ends what the other reads. */
const socketPair = Effect.gen(function* () {
  const toFirst = yield* Queue.unbounded<string, Cause.Done>();
  const toSecond = yield* Queue.unbounded<string, Cause.Done>();
  const end = (inbox: Queue.Queue<string, Cause.Done>, outbox: Queue.Queue<string, Cause.Done>) =>
    Socket.make({
      reader: Effect.succeed({
        pull: Queue.take(inbox).pipe(
          Effect.map((text): readonly [string] => [text]),
          Effect.mapError(
            () => new Socket.SocketError({ reason: new Socket.SocketCloseError({ code: 1000 }) }),
          ),
        ),
        upgrade: () => Effect.void,
      }),
      writer: Effect.succeed({
        write: (chunk) =>
          typeof chunk === 'string'
            ? Queue.offer(outbox, chunk).pipe(Effect.asVoid)
            : Queue.end(outbox).pipe(Effect.asVoid),
        writeAll: (chunks) =>
          Effect.forEach(chunks, (chunk) =>
            typeof chunk === 'string' ? Queue.offer(outbox, chunk) : Effect.void,
          ).pipe(Effect.asVoid),
      }),
    });
  return [end(toFirst, toSecond), end(toSecond, toFirst), () => Queue.end(toSecond)] as const;
});

describe('a connection over a socket', () => {
  it.effect('carries frames on both channels, each on the channel it was sent on', () =>
    Effect.gen(function* () {
      const [first, second] = yield* socketPair;
      const sending = yield* SocketTransport.fromSocket(first);
      const receiving = yield* SocketTransport.fromSocket(second);

      yield* sending.send({ channel: 'reliable', payload: 'hello' });
      yield* sending.send({ channel: 'unreliable', payload: 'a world' });
      const received = yield* receiving.frames.pipe(Stream.take(2), Stream.runCollect);

      expect(received).toEqual([
        { channel: 'reliable', payload: 'hello' },
        { channel: 'unreliable', payload: 'a world' },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect('ends its frames once the other end closes', () =>
    Effect.gen(function* () {
      const [, second, closeFirst] = yield* socketPair;
      const receiving = yield* SocketTransport.fromSocket(second);

      yield* closeFirst();
      const received = yield* receiving.frames.pipe(Stream.runCollect);

      expect(received).toEqual([]);
    }).pipe(Effect.scoped),
  );

  // Real time: a socket that cannot be written to is found out only when something is sent.
  it.live('ends its frames once a frame cannot be sent, as the socket is broken', () =>
    Effect.gen(function* () {
      const broken = Socket.make({
        reader: Effect.succeed({ pull: Effect.never, upgrade: () => Effect.void }),
        writer: Effect.succeed({
          write: () =>
            Effect.fail(
              new Socket.SocketError({ reason: new Socket.SocketCloseError({ code: 1006 }) }),
            ),
          writeAll: () =>
            Effect.fail(
              new Socket.SocketError({ reason: new Socket.SocketCloseError({ code: 1006 }) }),
            ),
        }),
      });
      const connection = yield* SocketTransport.fromSocket(broken);

      yield* connection.send({ channel: 'reliable', payload: 'hello' });
      const received = yield* connection.frames.pipe(
        Stream.runCollect,
        Effect.timeoutOption('300 millis'),
      );

      expect(received).toEqual(Option.some([]));
    }).pipe(Effect.scoped),
  );
});
