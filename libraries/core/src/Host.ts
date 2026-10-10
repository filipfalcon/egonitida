import { Clock, Effect, Option, Schema, type Scope, Stream } from 'effect';
import type * as Component from '#src/Component.ts';
import * as Game from '#src/Game.ts';
import * as Input from '#src/Input.ts';
import * as Pace from '#src/Pace.ts';
import * as Protocol from '#src/Protocol.ts';
import * as Snapshot from '#src/Snapshot.ts';
import type * as Transport from '#src/Transport.ts';
import type * as World from '#src/World.ts';

/**
 * Hosts a game: steps its world at the game's rate, takes the input its clients send, and sends every client the world after each step. It does not know where it runs; a Web Worker, a Durable Object, and a test each give it their own connections and their own clock.
 */

export interface Options {
  readonly game: Game.Game;
  readonly world: World.World;
  /** Every component the game uses, so input and snapshots can be decoded by their schemas. */
  readonly components: ReadonlyArray<Component.Any>;
  /** Spawns the entity a joining client will control. */
  readonly join: (world: World.World) => readonly [World.World, World.Entity];
  /** Removes what a leaving client controlled. */
  readonly leave: (world: World.World, entity: World.Entity) => World.World;
  /** The most steps taken at once to catch up after a stall. */
  readonly maxCatchUpSteps?: number;
}

export interface Host {
  /** Joins a client through `connection`, until the scope closes; returns the entity it controls. */
  readonly connect: (
    connection: Transport.Connection,
  ) => Effect.Effect<World.Entity, never, Scope.Scope>;
  readonly world: Effect.Effect<World.World>;
}

export const make = (options: Options): Effect.Effect<Host, never, Scope.Scope> =>
  Effect.gen(function* () {
    const inputComponents = new Map(
      options.components
        .filter((component): component is Input.InputComponent => component.owner === 'input')
        .map((component) => [component.name, component]),
    );
    const state = {
      world: options.world,
      connections: new Set<Transport.Connection>(),
      /** The newest input of each client, waiting for the next step. */
      pending: new Map<World.Entity, ReadonlyArray<Input.Input>>(),
      lastSeq: new Map<World.Entity, number>(),
      pace: Pace.start({
        now: yield* Clock.currentTimeMillis,
        stepRate: options.game.stepRate,
        maxSteps: options.maxCatchUpSteps ?? 5,
      }),
      done: 0,
    };

    // Every step real time owes: the waiting input goes into the first, the rest only move time on.
    const takeDueSteps = Effect.gen(function* () {
      const { steps, pace } = Pace.due(state.pace, state.done, yield* Clock.currentTimeMillis);
      state.pace = pace;
      if (steps === 0) {
        return;
      }
      state.done += steps;
      const inputs = [...state.pending.values()].flat();
      state.pending.clear();
      state.world = Game.step(options.game, state.world, inputs).world;
      for (let step = 1; step < steps; step += 1) {
        state.world = Game.step(options.game, state.world).world;
      }
      const payload = Snapshot.encode(state.world, options.components);
      yield* Effect.forEach(
        state.connections,
        (connection) => connection.send({ channel: 'unreliable', payload }),
        { discard: true },
      );
    });

    yield* Effect.gen(function* () {
      const wait = Pace.nextAt(state.pace, state.done) - (yield* Clock.currentTimeMillis);
      if (wait > 0) {
        yield* Effect.sleep(`${wait} millis`);
      }
      yield* takeDueSteps;
    }).pipe(Effect.forever, Effect.forkScoped);

    /** Keeps a client's newest input, decoded by the schemas of input components only. */
    const receive = (entity: World.Entity, frame: Transport.Frame) => {
      if (frame.channel !== 'unreliable') {
        return;
      }
      Option.map(Protocol.decodeInputs(frame.payload), ({ inputs }) => {
        const last = state.lastSeq.get(entity) ?? 0;
        const newest = inputs.reduce<Protocol.Inputs['inputs'][number] | undefined>(
          (found, input) =>
            input.seq > last && (found === undefined || input.seq > found.seq) ? input : found,
          undefined,
        );
        if (newest === undefined) {
          return;
        }
        state.lastSeq.set(entity, newest.seq);
        state.pending.set(
          entity,
          Object.entries(newest.values).flatMap(([name, encoded]) => {
            const component = inputComponents.get(name);
            return component === undefined
              ? []
              : Option.match(Schema.decodeUnknownOption(component.schema)(encoded), {
                  onNone: () => [],
                  onSome: (value) => [Input.of(entity, component, value)],
                });
          }),
        );
      });
    };

    const connect = (connection: Transport.Connection) =>
      Effect.gen(function* () {
        const [world, entity] = options.join(state.world);
        state.world = world;
        state.connections.add(connection);
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            state.connections.delete(connection);
            state.pending.delete(entity);
            state.lastSeq.delete(entity);
            state.world = options.leave(state.world, entity);
          }),
        );
        yield* connection.send({
          channel: 'reliable',
          payload: Protocol.encodeWelcome({ entity, stepRate: options.game.stepRate }),
        });
        yield* connection.frames.pipe(
          Stream.runForEach((frame) => Effect.sync(() => receive(entity, frame))),
          Effect.forkScoped,
        );
        return entity;
      });

    return { connect, world: Effect.sync(() => state.world) };
  });
