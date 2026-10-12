import { Data, Deferred, Effect, Option, PubSub, type Scope, Stream } from 'effect';
import type * as Action from '#src/Action.ts';
import type * as Component from '#src/Component.ts';
import type * as Event from '#src/Event.ts';
import * as Game from '#src/Game.ts';
import * as Protocol from '#src/Protocol.ts';
import * as Snapshot from '#src/Snapshot.ts';
import type * as Transport from '#src/Transport.ts';
import * as State from '#src/State.ts';

/**
 * A player's side of a session: joins a host, sends it the player's input, and keeps the newest state the host sent, with what the client keeps for itself stepped by the game's local systems through every tick the state reached. It draws nothing and predicts nothing yet; it is what both are built on.
 */

export interface Options {
  /** The game the host plays, whose components decode its snapshots. */
  readonly game: Game.Game;
}

export interface Client {
  /** The entity this client controls. */
  readonly entity: State.Entity;
  /** The rate the host steps its game at, as it said on welcoming the client. */
  readonly stepRate: number;
  /** The newest state the host sent. */
  readonly state: Effect.Effect<State.State>;
  /** Every state the client receives from now on that is newer than the one before, in order. */
  readonly states: Stream.Stream<State.State>;
  /** Sends the player's input, as values of input components, and gives the number it was sent as. */
  readonly send: (values: ReadonlyArray<Component.Instance>) => Effect.Effect<number>;
  /** The number of the newest input of this client's that the state at `tick` took in, if the host said so: 0 for none yet. Inputs numbered above it are yet to be, which a client predicting its own player plays ahead. */
  readonly ackedAt: (tick: number) => Option.Option<number>;
  /** Asks the host to hold time; a host that does not allow it goes on. */
  readonly hold: Effect.Effect<void>;
  /** Lets go of time this client held. */
  readonly release: Effect.Effect<void>;
  /** Sends the host a control, such as a development tool's, which whatever listens beside the host reads; the game never sees it. */
  readonly control: (payload: unknown) => Effect.Effect<void>;
  /** Asks whatever answers beside the host a question, such as a debugger's, and waits for its answer; the game never sees it. */
  readonly ask: (question: unknown) => Effect.Effect<unknown, Unanswered>;
  /** Takes an action, which the host hands to the rules at its next step, as from this client's player. */
  readonly act: <Sent>(
    action: Action.Action<string, Sent, Event.Tagged>,
    value: Sent,
  ) => Effect.Effect<void>;
}

/** Why a question went unanswered: nothing beside the host answers, it refused, or the host answers no client's questions. */
export class Unanswered extends Data.TaggedError('Unanswered')<{ readonly reason: string }> {}

type SentInput = Protocol.Inputs['inputs'][number];

const encodeValues = (values: ReadonlyArray<Component.Instance>): SentInput['values'] =>
  Object.fromEntries(
    values
      .filter((instance) => instance.component.owner === 'input')
      .map((instance) => [instance.component.name, instance.encoded()]),
  );

/** The most ticks a client steps what it keeps for itself through at once. */
const MAX_LOCAL_STEPS = 5;

/** How many states a client keeps, with what it kept for itself at each, so a host going back in time finds them: ten seconds at 60 steps a second. */
const KEPT_STATES = 600;

/** Joins the host at the other end of `connection`, until the scope closes. */
export const connect = (
  connection: Transport.Connection,
  options: Options,
): Effect.Effect<Client, never, Scope.Scope> =>
  Effect.gen(function* () {
    const welcome = yield* Deferred.make<Protocol.Welcome>();
    // Each listener gets its own subscription, from the moment it starts listening.
    const received = yield* PubSub.unbounded<State.State>();
    const receiving: {
      state: State.State;
      era: number;
      /** The states lately received, oldest first, with what the client kept for itself at each. */
      kept: ReadonlyArray<State.State>;
      seq: number;
      history: ReadonlyArray<SentInput>;
      /** The number of the newest input each lately received state took in, by its tick. */
      acked: Map<number, number>;
    } = {
      state: State.empty({ seed: 0 }),
      era: 0,
      kept: [],
      seq: 0,
      history: [],
      acked: new Map(),
    };

    /**
     * `state` with what the client keeps for itself stepped through every tick since `since` to the state's own: a snapshot lost on the way is still stepped through. After a long gap, such as on joining, only the last few are, as a host catches up only so far.
     */
    const keepUp = (state: State.State, since: number) =>
      Array.from({ length: Math.min(state.tick - since, MAX_LOCAL_STEPS) }, (_, back) => back)
        .reverse()
        .reduce(
          (current, back) => Game.stepLocal(options.game, current, { tick: state.tick - back }),
          state,
        );

    /**
     * A state the host went back to, or shows: with what the client kept for itself at its tick, if the client still has that tick, and with nothing of its own otherwise, since what it keeps now belongs to another time.
     */
    const backTo = (text: string, tick: number) => {
      const then = receiving.kept.find((kept) => kept.tick === tick);
      const base = then ?? { ...receiving.state, stores: new Map() };
      return Option.map(Snapshot.apply(base, text, options.game), ({ state }) => state);
    };

    // The questions asked and not yet answered, by their ids.
    const asked = { next: 0, waiting: new Map<number, Deferred.Deferred<unknown, Unanswered>>() };
    const replied = (message: Protocol.HostReliable) =>
      Effect.suspend(() => {
        const waiting = asked.waiting.get(message.id);
        asked.waiting.delete(message.id);
        return waiting === undefined
          ? Effect.void
          : message._tag === 'Answered'
            ? Deferred.succeed(waiting, message.answer)
            : Deferred.fail(waiting, new Unanswered({ reason: message.reason }));
      });

    const receive = (frame: Transport.Frame) =>
      frame.channel === 'reliable'
        ? Option.match(Protocol.decodeHostReliable(frame.payload), {
            onSome: (message) => Effect.asVoid(replied(message)),
            onNone: () =>
              Option.match(Protocol.decodeWelcome(frame.payload), {
                onNone: () => Effect.void,
                onSome: (received) => Deferred.succeed(welcome, received).pipe(Effect.asVoid),
              }),
          })
        : Option.match(Protocol.decodeAcked(frame.payload), {
            onSome: ({ tick, seq }) =>
              Effect.sync(() => {
                receiving.acked.set(tick, seq);
                // As many as the states kept, the oldest let go first.
                for (const old of receiving.acked.keys()) {
                  if (receiving.acked.size <= KEPT_STATES) {
                    break;
                  }
                  receiving.acked.delete(old);
                }
              }),
            onNone: () =>
              Option.match(Snapshot.apply(receiving.state, frame.payload, options.game), {
                onNone: () => Effect.void,
                onSome: ({ era, state }) =>
                  Effect.suspend(() => {
                    // A snapshot of an earlier era, or older than the state already held in this one, arrived out of order, and is of no use.
                    if (
                      era < receiving.era ||
                      (era === receiving.era && state.tick <= receiving.state.tick)
                    ) {
                      return Effect.void;
                    }
                    const next =
                      era > receiving.era
                        ? backTo(frame.payload, state.tick)
                        : Option.some(keepUp(state, receiving.state.tick));
                    return Option.match(next, {
                      onNone: () => Effect.void,
                      onSome: (arrived) => {
                        receiving.era = era;
                        receiving.state = arrived;
                        receiving.kept = [...receiving.kept, arrived].slice(-KEPT_STATES);
                        return PubSub.publish(received, arrived).pipe(Effect.asVoid);
                      },
                    });
                  }),
              }),
          });

    yield* connection.frames.pipe(Stream.runForEach(receive), Effect.forkScoped);
    const { entity, stepRate } = yield* Deferred.await(welcome);

    const send = (values: ReadonlyArray<Component.Instance>) =>
      Effect.suspend(() => {
        receiving.seq += 1;
        receiving.history = [
          { seq: receiving.seq, values: encodeValues(values) },
          ...receiving.history,
        ].slice(0, Protocol.MAX_REPEATED_INPUTS);
        return connection
          .send({
            channel: 'unreliable',
            payload: Protocol.encodeInputs({ inputs: receiving.history }),
          })
          .pipe(Effect.as(receiving.seq));
      });

    const tell = (message: Protocol.ClientReliable) =>
      connection.send({ channel: 'reliable', payload: Protocol.encodeClientReliable(message) });

    const ask = (question: unknown) =>
      Effect.gen(function* () {
        const waiting = yield* Deferred.make<unknown, Unanswered>();
        const id = asked.next;
        asked.next += 1;
        asked.waiting.set(id, waiting);
        yield* tell({ _tag: 'Ask', id, question });
        return yield* Deferred.await(waiting);
      });

    return {
      entity,
      stepRate,
      state: Effect.sync(() => receiving.state),
      states: Stream.fromPubSub(received),
      send,
      ackedAt: (tick) => Option.fromNullishOr(receiving.acked.get(tick)),
      hold: tell({ _tag: 'Hold' }),
      release: tell({ _tag: 'Release' }),
      act: (action, value) => tell({ _tag: 'Act', action: action.encode(value) }),
      control: (payload) => tell({ _tag: 'Control', payload }),
      ask,
    };
  });
