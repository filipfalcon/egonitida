import { Deferred, Effect, Option, type Scope, Stream } from 'effect';
import type * as Component from '#src/Component.ts';
import * as Protocol from '#src/Protocol.ts';
import * as Snapshot from '#src/Snapshot.ts';
import type * as Transport from '#src/Transport.ts';
import * as World from '#src/World.ts';

/**
 * A player's side of a session: joins a host, sends it the player's input, and keeps the newest world the host sent. It draws nothing and predicts nothing yet; it is what both are built on.
 */

export interface Options {
  /** Every component the game uses, so snapshots can be decoded by their schemas. */
  readonly components: ReadonlyArray<Component.Any>;
}

export interface Client {
  /** The entity this client controls. */
  readonly entity: World.Entity;
  /** The newest world the host sent. */
  readonly world: Effect.Effect<World.World>;
  /** Sends the player's input, as values of input components. */
  readonly send: (values: ReadonlyArray<Component.Instance>) => Effect.Effect<void>;
  /** Asks the host to hold time; a host that does not allow it goes on. */
  readonly hold: Effect.Effect<void>;
  /** Lets go of time this client held. */
  readonly release: Effect.Effect<void>;
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
        : Effect.sync(() => {
            Option.map(Snapshot.apply(state.world, frame.payload, options.components), (world) => {
              if (world.tick > state.world.tick) {
                state.world = world;
              }
            });
          });

    yield* connection.frames.pipe(Stream.runForEach(receive), Effect.forkScoped);
    const { entity } = yield* Deferred.await(welcome);

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
      world: Effect.sync(() => state.world),
      send,
      hold: ask({ _tag: 'Hold' }),
      release: ask({ _tag: 'Release' }),
    };
  });
