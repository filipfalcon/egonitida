import { Data, Deferred, Effect, Option, PubSub, type Scope, Stream } from 'effect';
import type * as Action from '#src/Action.ts';
import type * as Component from '#src/Component.ts';
import type * as Event from '#src/Event.ts';
import * as Game from '#src/Game.ts';
import * as Protocol from '#src/Protocol.ts';
import * as Snapshot from '#src/Snapshot.ts';
import type * as Transport from '#src/Transport.ts';
import * as World from '#src/World.ts';

/**
 * A player's side of a session: joins a host, sends it the player's input, and keeps the newest world the host sent, with what the client keeps for itself stepped by the game's local systems through every tick the world reached. It draws nothing and predicts nothing yet; it is what both are built on.
 */

export interface Options {
  /** The game the host plays, whose components decode its snapshots. */
  readonly game: Game.Game;
}

export interface Client {
  /** The entity this client controls. */
  readonly entity: World.Entity;
  /** The rate the host steps its world at, as it said on welcoming the client. */
  readonly stepRate: number;
  /** The newest world the host sent. */
  readonly world: Effect.Effect<World.World>;
  /** Every world the client receives from now on that is newer than the one before, in order. */
  readonly worlds: Stream.Stream<World.World>;
  /** Sends the player's input, as values of input components. */
  readonly send: (values: ReadonlyArray<Component.Instance>) => Effect.Effect<void>;
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

/** How many worlds a client keeps, with what it kept for itself at each, so a host going back in time finds them: ten seconds at 60 steps a second. */
const KEPT_WORLDS = 600;

/** Joins the host at the other end of `connection`, until the scope closes. */
export const connect = (
  connection: Transport.Connection,
  options: Options,
): Effect.Effect<Client, never, Scope.Scope> =>
  Effect.gen(function* () {
    const welcome = yield* Deferred.make<Protocol.Welcome>();
    // Each listener gets its own subscription, from the moment it starts listening.
    const received = yield* PubSub.unbounded<World.World>();
    const state: {
      world: World.World;
      era: number;
      /** The worlds lately received, oldest first, with what the client kept for itself at each. */
      kept: ReadonlyArray<World.World>;
      seq: number;
      history: ReadonlyArray<SentInput>;
    } = {
      world: World.empty({ seed: 0 }),
      era: 0,
      kept: [],
      seq: 0,
      history: [],
    };

    /**
     * `world` with what the client keeps for itself stepped through every tick since `since` to the world's own: a snapshot lost on the way is still stepped through. After a long gap, such as on joining, only the last few are, as a host catches up only so far.
     */
    const keepUp = (world: World.World, since: number) =>
      Array.from({ length: Math.min(world.tick - since, MAX_LOCAL_STEPS) }, (_, back) => back)
        .reverse()
        .reduce(
          (current, back) => Game.stepLocal(options.game, current, { tick: world.tick - back }),
          world,
        );

    /**
     * A world the host went back to, or shows: with what the client kept for itself at its tick, if the client still has that tick, and with nothing of its own otherwise, since what it keeps now belongs to another time.
     */
    const backTo = (text: string, tick: number) => {
      const then = state.kept.find((kept) => kept.tick === tick);
      const base = then ?? { ...state.world, stores: new Map() };
      return Option.map(Snapshot.apply(base, text, options.game), ({ world }) => world);
    };

    // A snapshot of an earlier era, or older than the world already held in this one, arrived out of order, and is of no use.
    // The questions asked and not yet answered, by their ids.
    const asked = { next: 0, waiting: new Map<number, Deferred.Deferred<unknown, Unanswered>>() };
    const answered = ({ id, outcome }: Protocol.Answer) =>
      Effect.suspend(() => {
        const waiting = asked.waiting.get(id);
        asked.waiting.delete(id);
        return waiting === undefined
          ? Effect.void
          : outcome._tag === 'Answered'
            ? Deferred.succeed(waiting, outcome.answer)
            : Deferred.fail(waiting, new Unanswered({ reason: outcome.reason }));
      });

    const receive = (frame: Transport.Frame) =>
      frame.channel === 'reliable'
        ? Option.match(Protocol.decodeAnswer(frame.payload), {
            onSome: (answer) => Effect.asVoid(answered(answer)),
            onNone: () =>
              Option.match(Protocol.decodeWelcome(frame.payload), {
                onNone: () => Effect.void,
                onSome: (received) => Deferred.succeed(welcome, received).pipe(Effect.asVoid),
              }),
          })
        : Option.match(Snapshot.apply(state.world, frame.payload, options.game), {
            onNone: () => Effect.void,
            onSome: ({ era, world }) =>
              Effect.suspend(() => {
                if (era < state.era || (era === state.era && world.tick <= state.world.tick)) {
                  return Effect.void;
                }
                const next =
                  era > state.era
                    ? backTo(frame.payload, world.tick)
                    : Option.some(keepUp(world, state.world.tick));
                return Option.match(next, {
                  onNone: () => Effect.void,
                  onSome: (arrived) => {
                    state.era = era;
                    state.world = arrived;
                    state.kept = [...state.kept, arrived].slice(-KEPT_WORLDS);
                    return PubSub.publish(received, arrived).pipe(Effect.asVoid);
                  },
                });
              }),
          });

    yield* connection.frames.pipe(Stream.runForEach(receive), Effect.forkScoped);
    const { entity, stepRate } = yield* Deferred.await(welcome);

    const send = (values: ReadonlyArray<Component.Instance>) =>
      Effect.suspend(() => {
        state.seq += 1;
        state.history = [{ seq: state.seq, values: encodeValues(values) }, ...state.history].slice(
          0,
          Protocol.MAX_REPEATED_INPUTS,
        );
        return connection.send({
          channel: 'unreliable',
          payload: Protocol.encodeInputs({ inputs: state.history }),
        });
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
      world: Effect.sync(() => state.world),
      worlds: Stream.fromPubSub(received),
      send,
      hold: tell({ _tag: 'Hold' }),
      release: tell({ _tag: 'Release' }),
      act: (action, value) => tell({ _tag: 'Act', action: action.encode(value) }),
      control: (payload) => tell({ _tag: 'Control', payload }),
      ask,
    };
  });
