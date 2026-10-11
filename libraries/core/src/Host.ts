import { Clock, Effect, Latch, Option, PubSub, Schema, type Scope, Stream } from 'effect';
import type * as Action from '#src/Action.ts';
import type * as Command from '#src/Command.ts';
import type * as Component from '#src/Component.ts';
import type * as Event from '#src/Event.ts';
import * as Game from '#src/Game.ts';
import * as Input from '#src/Input.ts';
import * as Pace from '#src/Pace.ts';
import * as Protocol from '#src/Protocol.ts';
import * as Snapshot from '#src/Snapshot.ts';
import type * as Transport from '#src/Transport.ts';
import type * as World from '#src/World.ts';

/**
 * Hosts a game: steps its world at the game's rate, takes the input its clients send, and sends every client the world after each step. It does not know where it runs; a Web Worker, a Durable Object, and a test each give it their own connections and their own clock.
 *
 * Everything that changes its world can be watched, so the world can be told again from where watching began: a client joining or leaving, which happens between steps, and every step, with the input and actions that went into it. Command results enter as actions, so they are among them.
 *
 * It also runs the commands the game's rules issue, once the step that issued them is over, with the services of the Layers it is given; so hosting a game that saves needs whatever it saves to. A command's result enters the world at the next step taken after it comes, as actions do. A command that breaks is reported, has no result, and stops nothing.
 */

/** What it takes to host a game whose commands need `Services`. */
export interface Options<Services = never> {
  readonly game: Game.Game<
    Component.Any,
    Action.Any,
    Event.Any,
    Command.Command<string, unknown, Event.Any, Services>
  >;
  readonly world: World.World;
  /** Spawns the entity a joining client will control. */
  readonly join: (world: World.World) => readonly [World.World, World.Entity];
  /** Removes what a leaving client controlled. */
  readonly leave: (world: World.World, entity: World.Entity) => World.World;
  /** The most steps taken at once to catch up after a stall. */
  readonly maxCatchUpSteps?: number;
  /** Freezes every world the host steps to, so a system or rule that changes a value in place throws at once; for development, since it walks the whole world every step. */
  readonly freeze?: boolean;
  /**
   * Whether a client may hold time: a local server for one player grants it, a world shared with others refuses. Holding time is the host's to allow, never the world's.
   */
  readonly mayHold: boolean;
}

/** What changed a host's world: a client joining or leaving, between steps, by the game's own `join` and `leave`, or a step taken, with the input that reached it and the actions, in the order the rules took them. */
export type Happening =
  | { readonly _tag: 'Joined'; readonly entity: World.Entity }
  | { readonly _tag: 'Left'; readonly entity: World.Entity }
  | {
      readonly _tag: 'Stepped';
      /** The tick the step took the world to. */
      readonly tick: number;
      readonly inputs: ReadonlyArray<Input.Input>;
      readonly actions: ReadonlyArray<Event.Tagged>;
    };

/** A host's world as it was when watching began, and everything that has happened to it since, in order. */
export interface Watching {
  readonly world: World.World;
  readonly happenings: Stream.Stream<Happening>;
}

export interface Host {
  /** Joins a client through `connection`, until the scope closes; returns the entity it controls. */
  readonly connect: (
    connection: Transport.Connection,
  ) => Effect.Effect<World.Entity, never, Scope.Scope>;
  readonly world: Effect.Effect<World.World>;
  /** Watches the world until the scope closes: where it is now, and everything that happens to it from now on, with nothing missed between the two. */
  readonly watch: Effect.Effect<Watching, never, Scope.Scope>;
}

export const make = <Services = never>(
  options: Options<Services>,
): Effect.Effect<Host, never, Scope.Scope | Services> =>
  Effect.gen(function* () {
    const inputComponents = new Map(
      options.game.components
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
      /** The clients holding time now; time stands while there is any. */
      holders: new Set<World.Entity>(),
      /** The players' actions waiting for the next step, in the order they came. */
      acted: new Array<Event.Tagged>(),
      heldSince: Option.none<number>(),
    };
    const happened = yield* PubSub.unbounded<Happening>();
    // Open while time runs; the loop waits here while it is held.
    const running = yield* Latch.make(true);

    /** Stops or lets go of time to match whether anyone holds it; on letting go, the time held is never owed. */
    const settleHold = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      if (state.holders.size > 0 && Option.isNone(state.heldSince)) {
        state.heldSince = Option.some(now);
        yield* Latch.close(running);
      } else if (state.holders.size === 0 && Option.isSome(state.heldSince)) {
        state.pace = Pace.resume(state.pace, now - state.heldSince.value);
        state.heldSince = Option.none();
        yield* Latch.open(running);
      }
    });

    /** Runs a command on its own, its result waiting for the next step with the players' actions; one that breaks is reported and comes to nothing. */
    const run = (issued: Command.Issued<string, Services>) =>
      issued.execute.pipe(
        Effect.flatMap((result) =>
          Effect.sync(() => {
            state.acted.push(result);
          }),
        ),
        Effect.catchCause((cause) =>
          Effect.logError(`${issued.name} broke and came to nothing`, cause),
        ),
        Effect.forkScoped,
      );

    // Every step real time owes: the waiting input goes into the first, the rest only move time on.
    const takeDueSteps = Effect.gen(function* () {
      if (Option.isSome(state.heldSince)) {
        return;
      }
      const { steps, pace } = Pace.due(state.pace, state.done, yield* Clock.currentTimeMillis);
      state.pace = pace;
      if (steps === 0) {
        return;
      }
      state.done += steps;
      const inputs = [...state.pending.values()].flat();
      state.pending.clear();
      const actions = state.acted.splice(0);
      const stepping: Game.StepOptions = { freeze: options.freeze ?? false };
      for (let step = 0; step < steps; step += 1) {
        const taken = step === 0 ? { inputs, actions } : { inputs: [], actions: [] };
        const next = Game.step(options.game, state.world, taken.inputs, taken.actions, stepping);
        state.world = next.world;
        PubSub.publishUnsafe(happened, { _tag: 'Stepped', tick: next.world.tick, ...taken });
        yield* Effect.forEach(next.commands, run, { discard: true });
      }
      const payload = Snapshot.encode(state.world, options.game);
      yield* Effect.forEach(
        state.connections,
        (connection) => connection.send({ channel: 'unreliable', payload }),
        { discard: true },
      );
    });

    yield* Effect.gen(function* () {
      yield* Latch.await(running);
      const wait = Pace.nextAt(state.pace, state.done) - (yield* Clock.currentTimeMillis);
      if (wait > 0) {
        yield* Effect.sleep(`${wait} millis`);
      }
      yield* takeDueSteps;
    }).pipe(Effect.forever, Effect.forkScoped);

    /** Holds or lets go of time for a client, if the host allows holding at all. */
    const receiveReliable = (entity: World.Entity, frame: Transport.Frame) =>
      Option.match(Protocol.decodeClientReliable(frame.payload), {
        onNone: () => Effect.void,
        onSome: (message) =>
          Effect.suspend(() => {
            if (message._tag === 'Act') {
              // An action is taken as from the player whose connection it came on; one the game does not know is dropped.
              for (const action of options.game.actions) {
                Option.map(action.accept(message.action, entity), (accepted) =>
                  state.acted.push(accepted),
                );
              }
              return Effect.void;
            }
            if (!options.mayHold) {
              return Effect.void;
            }
            if (message._tag === 'Hold') {
              state.holders.add(entity);
            } else {
              state.holders.delete(entity);
            }
            return settleHold;
          }),
      });

    /** Keeps a client's newest input, decoded by the schemas of input components only. */
    const receive = (entity: World.Entity, frame: Transport.Frame) => {
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
        PubSub.publishUnsafe(happened, { _tag: 'Joined', entity });
        state.connections.add(connection);
        yield* Effect.addFinalizer(() =>
          Effect.suspend(() => {
            state.connections.delete(connection);
            state.pending.delete(entity);
            state.lastSeq.delete(entity);
            state.holders.delete(entity);
            state.world = options.leave(state.world, entity);
            PubSub.publishUnsafe(happened, { _tag: 'Left', entity });
            // A client that leaves lets go of time it was holding.
            return settleHold;
          }),
        );
        yield* connection.send({
          channel: 'reliable',
          payload: Protocol.encodeWelcome({ entity, stepRate: options.game.stepRate }),
        });
        yield* connection.frames.pipe(
          Stream.runForEach((frame) =>
            frame.channel === 'reliable'
              ? receiveReliable(entity, frame)
              : Effect.sync(() => receive(entity, frame)),
          ),
          Effect.forkScoped,
        );
        return entity;
      });

    return {
      connect,
      world: Effect.sync(() => state.world),
      // Subscribing and reading the world happen with nothing in between, so the first happening told is the first after the world given.
      watch: Effect.map(PubSub.subscribe(happened), (subscription) => ({
        world: state.world,
        happenings: Stream.fromSubscription(subscription),
      })),
    };
  });
