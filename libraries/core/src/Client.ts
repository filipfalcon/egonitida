import { Deferred, Effect, Option, PubSub, type Scope, Stream } from 'effect';
import type * as Action from '#src/Action.ts';
import type * as Component from '#src/Component.ts';
import type * as Event from '#src/Event.ts';
import type * as Game from '#src/Game.ts';
import * as Protocol from '#src/Protocol.ts';
import * as Snapshot from '#src/Snapshot.ts';
import type * as Transport from '#src/Transport.ts';
import * as World from '#src/World.ts';

/**
 * A player's side of a session: joins a host, sends it the player's input, and keeps the newest world the host sent. It draws nothing and predicts nothing yet; it is what both are built on.
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
  /** Takes an action, which the host hands to the rules at its next step, as from this client's player. */
  readonly act: <Sent>(
    action: Action.Action<string, Sent, Event.Tagged>,
    value: Sent,
  ) => Effect.Effect<void>;
}

type SentInput = Protocol.Inputs['inputs'][number];

const encodeValues = (values: ReadonlyArray<Component.Instance>): SentInput['values'] =>
  Object.fromEntries(
    values
      .filter((instance) => instance.component.owner === 'input')
      .map((instance) => [instance.component.name, instance.encoded()]),
  );

/** Joins the host at the other end of `connection`, until the scope closes. */
export const connect = (
  connection: Transport.Connection,
  options: Options,
): Effect.Effect<Client, never, Scope.Scope> =>
  Effect.gen(function* () {
    const welcome = yield* Deferred.make<Protocol.Welcome>();
    // Each listener gets its own subscription, from the moment it starts listening.
    const received = yield* PubSub.unbounded<World.World>();
    const state: { world: World.World; seq: number; history: ReadonlyArray<SentInput> } = {
      world: World.empty({ seed: 0 }),
      seq: 0,
      history: [],
    };

    // A snapshot older than the world already held arrived out of order, and is of no use.
    const receive = (frame: Transport.Frame) =>
      frame.channel === 'reliable'
        ? Option.match(Protocol.decodeWelcome(frame.payload), {
            onNone: () => Effect.void,
            onSome: (received) => Deferred.succeed(welcome, received).pipe(Effect.asVoid),
          })
        : Option.match(Snapshot.apply(state.world, frame.payload, options.game.components), {
            onNone: () => Effect.void,
            onSome: (world) =>
              Effect.suspend(() => {
                if (world.tick <= state.world.tick) {
                  return Effect.void;
                }
                state.world = world;
                return PubSub.publish(received, world).pipe(Effect.asVoid);
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

    const ask = (message: Protocol.ClientReliable) =>
      connection.send({ channel: 'reliable', payload: Protocol.encodeClientReliable(message) });

    return {
      entity,
      stepRate,
      world: Effect.sync(() => state.world),
      worlds: Stream.fromPubSub(received),
      send,
      hold: ask({ _tag: 'Hold' }),
      release: ask({ _tag: 'Release' }),
      act: (action, value) => ask({ _tag: 'Act', action: action.encode(value) }),
    };
  });
