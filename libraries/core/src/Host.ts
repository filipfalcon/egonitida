import { Clock, Data, Effect, Latch, Option, PubSub, Schema, type Scope, Stream } from 'effect';
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

/** What a host plays: a game whose commands need `Services`, and how a client joins it and leaves. */
export interface Setup<Services = never> {
  readonly game: Game.Game<
    Component.Any,
    Action.Any,
    Event.Any,
    Command.Command<string, unknown, Event.Any, Services>
  >;
  /** Spawns the entity a joining client will control. */
  readonly join: (world: World.World) => readonly [World.World, World.Entity];
  /** Removes what a leaving client controlled. */
  readonly leave: (world: World.World, entity: World.Entity) => World.World;
}

/** What it takes to host a game whose commands need `Services`: what it plays, and the world it starts from. */
export interface Options<Services = never> extends Setup<Services> {
  readonly world: World.World;
  /** The most steps taken at once to catch up after a stall. */
  readonly maxCatchUpSteps?: number;
  /** Freezes every world the host steps to, so a system or rule that changes a value in place throws at once; for development, since it walks the whole world every step. */
  readonly freeze?: boolean;
  /**
   * Whether a client may hold time, and send controls: a local server for one player grants it, a world shared with others refuses. Holding time is the host's to allow, never the world's.
   */
  readonly mayHold: boolean;
}

/** What changed a host's world: a client joining or leaving, between steps, by the game's own `join` and `leave`, the host going back to a world it was given or taking up another game, or a step taken, with the input that reached it and the actions, in the order the rules took them. */
export type Happening =
  /** A player joined: through a client's connection, or from beside the host with no client. */
  | { readonly _tag: 'Joined'; readonly entity: World.Entity; readonly client: boolean }
  | { readonly _tag: 'Left'; readonly entity: World.Entity }
  /** The host went back to a world it was given, such as a past one, and steps on from it. */
  | { readonly _tag: 'Restored'; readonly world: World.World }
  /** The host plays another game from now on, such as a new build of its own, from the world it held, as the new game read it. */
  | ({ readonly _tag: 'Reloaded'; readonly world: World.World } & Setup<unknown>)
  | {
      readonly _tag: 'Stepped';
      /** The world the step took it to. */
      readonly world: World.World;
      readonly inputs: ReadonlyArray<Input.Input>;
      readonly actions: ReadonlyArray<Event.Tagged>;
    };

/** A host's world as it was when watching began, and everything that has happened to it since, in order. */
export interface Watching {
  readonly world: World.World;
  readonly happenings: Stream.Stream<Happening>;
}

/** A control a client sent, with the entity it controls. */
export interface Control {
  readonly entity: World.Entity;
  readonly payload: unknown;
}

/** A game a host was given in place of its own that it cannot play: one that cannot read the world it holds, or steps at another rate. */
export class Unreadable extends Data.TaggedError('Unreadable')<{ readonly reason: string }> {}

export interface Host<Services = never> {
  /** Joins a client through `connection`, until the scope closes; returns the entity it controls. */
  readonly connect: (
    connection: Transport.Connection,
  ) => Effect.Effect<World.Entity, never, Scope.Scope>;
  readonly world: Effect.Effect<World.World>;
  /** The controls clients send, such as a development tool's, from now on, as they come; a host that lets no client hold time passes on none. */
  readonly controls: Stream.Stream<Control>;
  /** Answers the questions clients ask, such as a debugger's, by `answer`, until the scope closes, as from the player of the entity that asked; what it fails with is the reason a question goes unanswered. A host that lets no client hold time answers none. */
  readonly answering: (
    answer: (question: unknown, entity: World.Entity) => Effect.Effect<unknown, string>,
  ) => Effect.Effect<void, never, Scope.Scope>;
  /** Joins a player with no client, from beside the host, such as one an agent plays: the game's own `join` makes its entity, as it does for a client. */
  readonly join: Effect.Effect<World.Entity>;
  /** Lets go of the player of `entity`, by the game's own `leave`, whoever joined it. */
  readonly leave: (entity: World.Entity) => Effect.Effect<void>;
  /** Takes input for `entity` from beside the host, such as from an agent playing it, each value read by its component's schema as it travels: it reaches the next step after what the entity's client sent, so it is what the step takes. */
  readonly input: (
    entity: World.Entity,
    values: ReadonlyArray<{ readonly component: string; readonly value: unknown }>,
  ) => Effect.Effect<void, Unreadable>;
  /** Takes an action as from the player of `entity`, from beside the host, read by the game's actions as one from a client is. */
  readonly act: (entity: World.Entity, action: unknown) => Effect.Effect<void, Unreadable>;
  /** Holds time for whatever runs beside the host, such as a development tool, as a client may hold it for itself. */
  readonly hold: Effect.Effect<void>;
  /** Lets go of time held beside the host; it runs on once no client holds it either. */
  readonly release: Effect.Effect<void>;
  /** Takes `steps` steps at once, beside those real time owes, and shows them to every client: how time held is stepped through. */
  readonly advance: (steps: number) => Effect.Effect<void>;
  /** Shows every client `world` in place of the one the host holds, such as a past one while time is held, and holds its own: a step taken after shows them its own again. */
  readonly show: (world: World.World) => Effect.Effect<void>;
  /** Plays `setup` from now on, such as a new build of the game, from the world the host holds, read by the new game; refuses one that cannot read it, and plays on as it was. */
  reload(setup: Setup<Services>): Effect.Effect<void, Unreadable>;
  /** Goes back to `world`, such as a past one, and steps on from it; every client is shown it at once. */
  readonly restore: (world: World.World) => Effect.Effect<void>;
  /** Watches the world until the scope closes: where it is now, and everything that happens to it from now on, with nothing missed between the two. */
  readonly watch: Effect.Effect<Watching, never, Scope.Scope>;
}

export const make = <Services = never>(
  options: Options<Services>,
): Effect.Effect<Host<Services>, never, Scope.Scope | Services> =>
  Effect.gen(function* () {
    /** The input components of `game`, by name. */
    const inputsOf = (game: Setup<Services>['game']) =>
      new Map(
        game.components
          .filter((component): component is Input.InputComponent => component.owner === 'input')
          .map((component) => [component.name, component]),
      );
    const state = {
      setup: { game: options.game, join: options.join, leave: options.leave },
      inputComponents: inputsOf(options.game),
      world: options.world,
      connections: new Set<Transport.Connection>(),
      /** The newest input of each client, waiting for the next step. */
      pending: new Map<World.Entity, ReadonlyArray<Input.Input>>(),
      /** The newest input given from beside the host for each entity, which goes in after its client's. */
      pendingBeside: new Map<World.Entity, ReadonlyArray<Input.Input>>(),
      lastSeq: new Map<World.Entity, number>(),
      pace: Pace.start({
        now: yield* Clock.currentTimeMillis,
        stepRate: options.game.stepRate,
        maxSteps: options.maxCatchUpSteps ?? 5,
      }),
      done: 0,
      /** The clients holding time now; time stands while there is any. */
      holders: new Set<World.Entity>(),
      /** Whether whatever runs beside the host, such as a development tool, holds time. */
      heldBeside: false,
      /** The players' actions waiting for the next step, in the order they came. */
      acted: new Array<Event.Tagged>(),
      heldSince: Option.none<number>(),
      /** Counts every time the host showed its clients another world than the one it stepped to, so they take it even if it is older. */
      era: 0,
    };
    // What the host was made with, so steps taken at a tool's word run their commands as the host's own do.
    const made = yield* Effect.context<Services | Scope.Scope>();
    const happened = yield* PubSub.unbounded<Happening>();
    const controlled = yield* PubSub.unbounded<Control>();
    // What answers the questions clients ask, while something does.
    const answers = {
      answer:
        Option.none<(question: unknown, entity: World.Entity) => Effect.Effect<unknown, string>>(),
    };
    /** The answer to `question`, asked by the player of `entity`, or why there is none. */
    const answerOf = (question: unknown, entity: World.Entity) =>
      !options.mayHold
        ? Effect.fail('This host answers no client’s questions.')
        : Option.match(answers.answer, {
            onNone: () => Effect.fail('Nothing beside the host answers questions.'),
            onSome: (answer) => answer(question, entity),
          });
    // Open while time runs; the loop waits here while it is held.
    const running = yield* Latch.make(true);

    /** Stops or lets go of time to match whether anyone holds it; on letting go, the time held is never owed. */
    const settleHold = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const held = state.heldBeside || state.holders.size > 0;
      if (held && Option.isNone(state.heldSince)) {
        state.heldSince = Option.some(now);
        yield* Latch.close(running);
      } else if (!held && Option.isSome(state.heldSince)) {
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

    /** Sends every client `world`, in the era it is now. */
    const broadcast = (world: World.World) =>
      Effect.suspend(() => {
        const payload = Snapshot.encode(world, state.setup.game, state.era);
        return Effect.forEach(
          state.connections,
          (connection) => connection.send({ channel: 'unreliable', payload }),
          { discard: true },
        );
      });

    /** Takes `count` steps: the waiting input and actions go into the first, the rest only move time on. */
    const takeSteps = (count: number) =>
      Effect.gen(function* () {
        const inputs = [...state.pending.values(), ...state.pendingBeside.values()].flat();
        state.pending.clear();
        state.pendingBeside.clear();
        const actions = state.acted.splice(0);
        const stepping: Game.StepOptions = { freeze: options.freeze ?? false };
        for (let step = 0; step < count; step += 1) {
          const taken = step === 0 ? { inputs, actions } : { inputs: [], actions: [] };
          const next = Game.step(
            state.setup.game,
            state.world,
            taken.inputs,
            taken.actions,
            stepping,
          );
          state.world = next.world;
          PubSub.publishUnsafe(happened, { _tag: 'Stepped', world: next.world, ...taken });
          yield* Effect.forEach(next.commands, run, { discard: true });
        }
      });

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
      yield* takeSteps(steps);
      yield* broadcast(state.world);
    });

    yield* Effect.gen(function* () {
      yield* Latch.await(running);
      const wait = Pace.nextAt(state.pace, state.done) - (yield* Clock.currentTimeMillis);
      if (wait > 0) {
        yield* Effect.sleep(`${wait} millis`);
      }
      yield* takeDueSteps;
    }).pipe(Effect.forever, Effect.forkScoped);

    /** Holds or lets go of time for a client, if the host allows holding at all, and answers its questions in `scope`, apart from its frames, so a slow answer holds nothing up. */
    const receiveReliable = (
      entity: World.Entity,
      frame: Transport.Frame,
      connection: Transport.Connection,
      scope: Scope.Scope,
    ) =>
      Option.match(Protocol.decodeClientReliable(frame.payload), {
        onNone: () => Effect.void,
        onSome: (message) =>
          Effect.suspend(() => {
            if (message._tag === 'Act') {
              // An action is taken as from the player whose connection it came on; one the game does not know is dropped.
              for (const action of state.setup.game.actions) {
                Option.map(action.accept(message.action, entity), (accepted) =>
                  state.acted.push(accepted),
                );
              }
              return Effect.void;
            }
            if (message._tag === 'Ask') {
              return answerOf(message.question, entity).pipe(
                Effect.match({
                  onSuccess: (answer): Protocol.Answer['outcome'] => ({ _tag: 'Answered', answer }),
                  onFailure: (reason): Protocol.Answer['outcome'] => ({
                    _tag: 'Unanswered',
                    reason,
                  }),
                }),
                Effect.flatMap((outcome) =>
                  connection.send({
                    channel: 'reliable',
                    payload: Protocol.encodeAnswer({ _tag: 'Answer', id: message.id, outcome }),
                  }),
                ),
                Effect.forkIn(scope),
                Effect.asVoid,
              );
            }
            if (!options.mayHold) {
              return Effect.void;
            }
            if (message._tag === 'Control') {
              return PubSub.publish(controlled, { entity, payload: message.payload });
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
            const component = state.inputComponents.get(name);
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
        const [world, entity] = state.setup.join(state.world);
        state.world = world;
        PubSub.publishUnsafe(happened, { _tag: 'Joined', entity, client: true });
        state.connections.add(connection);
        yield* Effect.addFinalizer(() =>
          Effect.suspend(() => {
            state.connections.delete(connection);
            state.pending.delete(entity);
            state.lastSeq.delete(entity);
            state.holders.delete(entity);
            state.world = state.setup.leave(state.world, entity);
            PubSub.publishUnsafe(happened, { _tag: 'Left', entity });
            // A client that leaves lets go of time it was holding.
            return settleHold;
          }),
        );
        yield* connection.send({
          channel: 'reliable',
          payload: Protocol.encodeWelcome({ entity, stepRate: state.setup.game.stepRate }),
        });
        const scope = yield* Effect.scope;
        yield* connection.frames.pipe(
          Stream.runForEach((frame) =>
            frame.channel === 'reliable'
              ? receiveReliable(entity, frame, connection, scope)
              : Effect.sync(() => receive(entity, frame)),
          ),
          Effect.forkScoped,
        );
        return entity;
      });

    return {
      connect,
      world: Effect.sync(() => state.world),
      controls: Stream.fromPubSub(controlled),
      answering: (answer) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            answers.answer = Option.some(answer);
          }),
          () =>
            Effect.sync(() => {
              answers.answer = Option.none();
            }),
        ),
      join: Effect.sync(() => {
        const [world, entity] = state.setup.join(state.world);
        state.world = world;
        PubSub.publishUnsafe(happened, { _tag: 'Joined', entity, client: false });
        return entity;
      }),
      leave: (entity) =>
        Effect.sync(() => {
          state.pendingBeside.delete(entity);
          state.world = state.setup.leave(state.world, entity);
          PubSub.publishUnsafe(happened, { _tag: 'Left', entity });
        }),
      input: (entity, values) =>
        Effect.gen(function* () {
          const inputs = yield* Effect.forEach(values, ({ component: name, value }) =>
            Effect.gen(function* () {
              const component = state.inputComponents.get(name);
              if (component === undefined) {
                return yield* new Unreadable({ reason: `${name} is no input of the game` });
              }
              const decoded = yield* Schema.decodeUnknownEffect(
                Schema.toCodecJson(component.schema),
              )(value).pipe(
                Effect.mapError((issue) => new Unreadable({ reason: `${name}: ${issue.message}` })),
              );
              return Input.of(entity, component, decoded);
            }),
          );
          state.pendingBeside.set(entity, inputs);
        }),
      act: (entity, action) =>
        Effect.suspend(() => {
          for (const known of state.setup.game.actions) {
            const accepted = known.accept(action, entity);
            if (Option.isSome(accepted)) {
              state.acted.push(accepted.value);
              return Effect.void;
            }
          }
          const tag =
            typeof action === 'object' && action !== null && '_tag' in action
              ? String(action._tag)
              : 'What was given';
          return Effect.fail(
            new Unreadable({ reason: `${tag} is no action of the game, or not one like it` }),
          );
        }),
      hold: Effect.suspend(() => {
        state.heldBeside = true;
        return settleHold;
      }),
      release: Effect.suspend(() => {
        state.heldBeside = false;
        return settleHold;
      }),
      advance: (steps) =>
        Effect.andThen(
          Effect.provideContext(takeSteps(steps), made),
          Effect.suspend(() => broadcast(state.world)),
        ),
      show: (world) =>
        Effect.suspend(() => {
          state.era += 1;
          return broadcast(world);
        }),
      reload: (setup) =>
        Effect.gen(function* () {
          if (setup.game.stepRate !== state.setup.game.stepRate) {
            return yield* new Unreadable({
              reason: `it steps ${setup.game.stepRate} times a second, not ${state.setup.game.stepRate}`,
            });
          }
          // A world its own game cannot encode is a bug in the engine; one the new game cannot read is the new game's to answer for.
          const encoded = yield* Schema.encodeEffect(Game.schema(state.setup.game))(
            state.world,
          ).pipe(Effect.orDie);
          const world = yield* Schema.decodeEffect(Game.schema(setup.game))(encoded).pipe(
            Effect.mapError((issue) => new Unreadable({ reason: issue.message })),
          );
          state.setup = { game: setup.game, join: setup.join, leave: setup.leave };
          state.inputComponents = inputsOf(setup.game);
          state.world = world;
          PubSub.publishUnsafe(happened, { _tag: 'Reloaded', world, ...state.setup });
        }),
      restore: (world) =>
        Effect.suspend(() => {
          state.world = world;
          state.era += 1;
          PubSub.publishUnsafe(happened, { _tag: 'Restored', world });
          return broadcast(world);
        }),
      // Subscribing and reading the world happen with nothing in between, so the first happening told is the first after the world given.
      watch: Effect.map(PubSub.subscribe(happened), (subscription) => ({
        world: state.world,
        happenings: Stream.fromSubscription(subscription),
      })),
    };
  });
