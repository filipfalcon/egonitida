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
import type * as State from '#src/State.ts';

/**
 * Hosts a game: steps it at its rate, takes the input its clients send, and sends every client the state after each step. It does not know where it runs; a Web Worker, a Durable Object, and a test each give it their own connections and their own clock.
 *
 * Everything that replaces its state can be watched, so its states can be told again from where watching began: a client joining or leaving, which happens between steps, and every step, with the input and actions that went into it. Command results enter as actions, so they are among them.
 *
 * It also runs the commands the game's rules issue, once the step that issued them is over, with the services of the Layers it is given; so hosting a game that saves needs whatever it saves to. A command's result enters the game at the next step taken after it comes, as actions do. A command that breaks is reported, has no result, and stops nothing.
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
  readonly join: (state: State.State) => readonly [State.State, State.Entity];
  /** Removes what a leaving client controlled. */
  readonly leave: (state: State.State, entity: State.Entity) => State.State;
}

/** What it takes to host a game whose commands need `Services`: what it plays, and the state it starts from. */
export interface Options<Services = never> extends Setup<Services> {
  readonly state: State.State;
  /** The most steps taken at once to catch up after a stall. */
  readonly maxCatchUpSteps?: number;
  /** Freezes every state the host steps to, so a system or rule that changes a value in place throws at once; for development, since it walks the whole state every step. */
  readonly freeze?: boolean;
  /**
   * Whether a client may hold time, and send controls: a local server for one player grants it, a room shared with others refuses. Holding time is the host's to allow, never the game's.
   */
  readonly mayHold: boolean;
}

/** What replaced a host's state: a client joining or leaving, between steps, by the game's own `join` and `leave`, the host going back to a state it was given or taking up another game, or a step taken, with the input that reached it and the actions, in the order the rules took them. */
export type Happening =
  /** A player joined: through a client's connection, or from beside the host with no client. */
  | { readonly _tag: 'Joined'; readonly entity: State.Entity; readonly client: boolean }
  | { readonly _tag: 'Left'; readonly entity: State.Entity }
  /** The host went back to a state it was given, such as a past one, and steps on from it. */
  | { readonly _tag: 'Restored'; readonly state: State.State }
  /** The host plays another game from now on, such as a new build of its own, from the state it held, as the new game read it. */
  | ({ readonly _tag: 'Reloaded'; readonly state: State.State } & Setup<unknown>)
  | {
      readonly _tag: 'Stepped';
      /** The state the step took it to. */
      readonly state: State.State;
      readonly inputs: ReadonlyArray<Input.Input>;
      readonly actions: ReadonlyArray<Event.Tagged>;
    };

/** A host's state as it was when watching began, and everything that has replaced it since, in order. */
export interface Watching {
  readonly state: State.State;
  readonly happenings: Stream.Stream<Happening>;
}

/** A control a client sent, with the entity it controls. */
export interface Control {
  readonly entity: State.Entity;
  readonly payload: unknown;
}

/** A game a host was given in place of its own that it cannot play: one that cannot read the state it holds, or steps at another rate. */
export class Unreadable extends Data.TaggedError('Unreadable')<{ readonly reason: string }> {}

export interface Host<Services = never> {
  /** Joins a client through `connection`, until the scope closes; returns the entity it controls. */
  readonly connect: (
    connection: Transport.Connection,
  ) => Effect.Effect<State.Entity, never, Scope.Scope>;
  readonly state: Effect.Effect<State.State>;
  /** The controls clients send, such as a development tool's, from now on, as they come; a host that lets no client hold time passes on none. */
  readonly controls: Stream.Stream<Control>;
  /** Answers the questions clients ask, such as a debugger's, by `answer`, until the scope closes, as from the player of the entity that asked; what it fails with is the reason a question goes unanswered. A host that lets no client hold time answers none. */
  readonly answering: (
    answer: (question: unknown, entity: State.Entity) => Effect.Effect<unknown, string>,
  ) => Effect.Effect<void, never, Scope.Scope>;
  /** Joins a player with no client, from beside the host, such as one an agent plays: the game's own `join` makes its entity, as it does for a client. */
  readonly join: Effect.Effect<State.Entity>;
  /** Lets go of the player of `entity`, by the game's own `leave`, whoever joined it. */
  readonly leave: (entity: State.Entity) => Effect.Effect<void>;
  /** Takes input for `entity` from beside the host, such as from an agent playing it, each value read by its component's schema as it travels: it reaches the next step after what the entity's client sent, so it is what the step takes. */
  readonly input: (
    entity: State.Entity,
    values: ReadonlyArray<{ readonly component: string; readonly value: unknown }>,
  ) => Effect.Effect<void, Unreadable>;
  /** Takes an action as from the player of `entity`, from beside the host, read by the game's actions as one from a client is. */
  readonly act: (entity: State.Entity, action: unknown) => Effect.Effect<void, Unreadable>;
  /** Holds time for whatever runs beside the host, such as a development tool, as a client may hold it for itself. */
  readonly hold: Effect.Effect<void>;
  /** Lets go of time held beside the host; it runs on once no client holds it either. */
  readonly release: Effect.Effect<void>;
  /** Takes `count` steps at once, beside those real time owes, and shows them to every client: how time held is stepped through. */
  readonly step: (count: number) => Effect.Effect<void>;
  /** Shows every client `state` in place of the one the host holds, such as a past one while time is held, and holds its own: a step taken after shows them its own again. */
  readonly show: (state: State.State) => Effect.Effect<void>;
  /** Plays `setup` from now on, such as a new build of the game, from the state the host holds, read by the new game; refuses one that cannot read it, and plays on as it was. */
  reload(setup: Setup<Services>): Effect.Effect<void, Unreadable>;
  /** Goes back to `state`, such as a past one, and steps on from it; every client is shown it at once. */
  readonly restore: (state: State.State) => Effect.Effect<void>;
  /** Watches the host's state until the scope closes: the state it holds now, and everything that replaces it from now on, with nothing missed between the two. */
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
    const hosted = {
      setup: { game: options.game, join: options.join, leave: options.leave },
      inputComponents: inputsOf(options.game),
      state: options.state,
      /** Every client's connection, with the entity it controls. */
      connections: new Map<Transport.Connection, State.Entity>(),
      /** The newest input of each client, waiting for the next step. */
      pending: new Map<State.Entity, ReadonlyArray<Input.Input>>(),
      /** The newest input given from beside the host for each entity, which goes in after its client's. */
      pendingBeside: new Map<State.Entity, ReadonlyArray<Input.Input>>(),
      lastSeq: new Map<State.Entity, number>(),
      pace: Pace.start({
        now: yield* Clock.currentTimeMillis,
        stepRate: options.game.stepRate,
        maxSteps: options.maxCatchUpSteps ?? 5,
      }),
      done: 0,
      /** The clients holding time now; time stands while there is any. */
      holders: new Set<State.Entity>(),
      /** Whether whatever runs beside the host, such as a development tool, holds time. */
      heldBeside: false,
      /** The players' actions waiting for the next step, in the order they came. */
      acted: new Array<Event.Tagged>(),
      heldSince: Option.none<number>(),
      /** Counts every time the host showed its clients another state than the one it stepped to, so they take it even if it is older. */
      era: 0,
    };
    // What the host was made with, so steps taken at a tool's word run their commands as the host's own do.
    const made = yield* Effect.context<Services | Scope.Scope>();
    const happened = yield* PubSub.unbounded<Happening>();
    const controlled = yield* PubSub.unbounded<Control>();
    // What answers the questions clients ask, while something does.
    const answers = {
      answer:
        Option.none<(question: unknown, entity: State.Entity) => Effect.Effect<unknown, string>>(),
    };
    /** The answer to `question`, asked by the player of `entity`, or why there is none. */
    const answerOf = (question: unknown, entity: State.Entity) =>
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
      const held = hosted.heldBeside || hosted.holders.size > 0;
      if (held && Option.isNone(hosted.heldSince)) {
        hosted.heldSince = Option.some(now);
        yield* Latch.close(running);
      } else if (!held && Option.isSome(hosted.heldSince)) {
        hosted.pace = Pace.resume(hosted.pace, now - hosted.heldSince.value);
        hosted.heldSince = Option.none();
        yield* Latch.open(running);
      }
    });

    /** Runs a command on its own, its result waiting for the next step with the players' actions; one that breaks is reported and comes to nothing. */
    const run = (issued: Command.Issued<string, Services>) =>
      issued.execute.pipe(
        Effect.flatMap((result) =>
          Effect.sync(() => {
            hosted.acted.push(result);
          }),
        ),
        Effect.catchCause((cause) =>
          Effect.logError(`${issued.name} broke and came to nothing`, cause),
        ),
        Effect.forkScoped,
      );

    /** Sends every client `state`, in the era it is now, and the number of its newest input the state took in. */
    const broadcast = (state: State.State) =>
      Effect.suspend(() => {
        const payload = Snapshot.encode(state, hosted.setup.game, hosted.era);
        return Effect.forEach(
          hosted.connections,
          ([connection, entity]) =>
            Effect.andThen(
              connection.send({ channel: 'unreliable', payload }),
              connection.send({
                channel: 'unreliable',
                payload: Protocol.encodeAcked({
                  _tag: 'Acked',
                  tick: state.tick,
                  seq: hosted.lastSeq.get(entity) ?? 0,
                }),
              }),
            ),
          { discard: true },
        );
      });

    /** Takes `count` steps: the waiting input and actions go into the first, the rest only move time on. */
    const takeSteps = (count: number) =>
      Effect.gen(function* () {
        const inputs = [...hosted.pending.values(), ...hosted.pendingBeside.values()].flat();
        hosted.pending.clear();
        hosted.pendingBeside.clear();
        const actions = hosted.acted.splice(0);
        const stepping: Game.StepOptions = { freeze: options.freeze ?? false };
        for (let step = 0; step < count; step += 1) {
          const taken = step === 0 ? { inputs, actions } : { inputs: [], actions: [] };
          const next = Game.step(
            hosted.setup.game,
            hosted.state,
            taken.inputs,
            taken.actions,
            stepping,
          );
          hosted.state = next.state;
          PubSub.publishUnsafe(happened, { _tag: 'Stepped', state: next.state, ...taken });
          yield* Effect.forEach(next.commands, run, { discard: true });
        }
      });

    // Every step real time owes: the waiting input goes into the first, the rest only move time on.
    const takeDueSteps = Effect.gen(function* () {
      if (Option.isSome(hosted.heldSince)) {
        return;
      }
      const { steps, pace } = Pace.due(hosted.pace, hosted.done, yield* Clock.currentTimeMillis);
      hosted.pace = pace;
      if (steps === 0) {
        return;
      }
      hosted.done += steps;
      yield* takeSteps(steps);
      yield* broadcast(hosted.state);
    });

    yield* Effect.gen(function* () {
      yield* Latch.await(running);
      const wait = Pace.nextAt(hosted.pace, hosted.done) - (yield* Clock.currentTimeMillis);
      if (wait > 0) {
        yield* Effect.sleep(`${wait} millis`);
      }
      yield* takeDueSteps;
    }).pipe(Effect.forever, Effect.forkScoped);

    /** Holds or lets go of time for a client, if the host allows holding at all, and answers its questions in `scope`, apart from its frames, so a slow answer holds nothing up. */
    const receiveReliable = (
      entity: State.Entity,
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
              for (const action of hosted.setup.game.actions) {
                Option.map(action.accept(message.action, entity), (accepted) =>
                  hosted.acted.push(accepted),
                );
              }
              return Effect.void;
            }
            if (message._tag === 'Ask') {
              return answerOf(message.question, entity).pipe(
                Effect.match({
                  onSuccess: (answer): Protocol.HostReliable => ({
                    _tag: 'Answered',
                    id: message.id,
                    answer,
                  }),
                  onFailure: (reason): Protocol.HostReliable => ({
                    _tag: 'Unanswered',
                    id: message.id,
                    reason,
                  }),
                }),
                Effect.flatMap((reply) =>
                  connection.send({
                    channel: 'reliable',
                    payload: Protocol.encodeHostReliable(reply),
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
              hosted.holders.add(entity);
            } else {
              hosted.holders.delete(entity);
            }
            return settleHold;
          }),
      });

    /** Keeps a client's newest input, decoded by the schemas of input components only. */
    const receive = (entity: State.Entity, frame: Transport.Frame) => {
      Option.map(Protocol.decodeInputs(frame.payload), ({ inputs }) => {
        const last = hosted.lastSeq.get(entity) ?? 0;
        const newest = inputs.reduce<Protocol.Inputs['inputs'][number] | undefined>(
          (found, input) =>
            input.seq > last && (found === undefined || input.seq > found.seq) ? input : found,
          undefined,
        );
        if (newest === undefined) {
          return;
        }
        hosted.lastSeq.set(entity, newest.seq);
        hosted.pending.set(
          entity,
          Object.entries(newest.values).flatMap(([name, encoded]) => {
            const component = hosted.inputComponents.get(name);
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
        const [state, entity] = hosted.setup.join(hosted.state);
        hosted.state = state;
        PubSub.publishUnsafe(happened, { _tag: 'Joined', entity, client: true });
        hosted.connections.set(connection, entity);
        yield* Effect.addFinalizer(() =>
          Effect.suspend(() => {
            hosted.connections.delete(connection);
            hosted.pending.delete(entity);
            hosted.lastSeq.delete(entity);
            hosted.holders.delete(entity);
            hosted.state = hosted.setup.leave(hosted.state, entity);
            PubSub.publishUnsafe(happened, { _tag: 'Left', entity });
            // A client that leaves lets go of time it was holding.
            return settleHold;
          }),
        );
        yield* connection.send({
          channel: 'reliable',
          payload: Protocol.encodeWelcome({ entity, stepRate: hosted.setup.game.stepRate }),
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
      state: Effect.sync(() => hosted.state),
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
        const [state, entity] = hosted.setup.join(hosted.state);
        hosted.state = state;
        PubSub.publishUnsafe(happened, { _tag: 'Joined', entity, client: false });
        return entity;
      }),
      leave: (entity) =>
        Effect.sync(() => {
          hosted.pendingBeside.delete(entity);
          hosted.state = hosted.setup.leave(hosted.state, entity);
          PubSub.publishUnsafe(happened, { _tag: 'Left', entity });
        }),
      input: (entity, values) =>
        Effect.gen(function* () {
          const inputs = yield* Effect.forEach(values, ({ component: name, value }) =>
            Effect.gen(function* () {
              const component = hosted.inputComponents.get(name);
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
          hosted.pendingBeside.set(entity, inputs);
        }),
      act: (entity, action) =>
        Effect.suspend(() => {
          for (const known of hosted.setup.game.actions) {
            const accepted = known.accept(action, entity);
            if (Option.isSome(accepted)) {
              hosted.acted.push(accepted.value);
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
        hosted.heldBeside = true;
        return settleHold;
      }),
      release: Effect.suspend(() => {
        hosted.heldBeside = false;
        return settleHold;
      }),
      step: (count) =>
        Effect.andThen(
          Effect.provideContext(takeSteps(count), made),
          Effect.suspend(() => broadcast(hosted.state)),
        ),
      show: (state) =>
        Effect.suspend(() => {
          hosted.era += 1;
          return broadcast(state);
        }),
      reload: (setup) =>
        Effect.gen(function* () {
          if (setup.game.stepRate !== hosted.setup.game.stepRate) {
            return yield* new Unreadable({
              reason: `it steps ${setup.game.stepRate} times a second, not ${hosted.setup.game.stepRate}`,
            });
          }
          // A state its own game cannot encode is a bug in the engine; one the new game cannot read is the new game's to account for.
          const encoded = yield* Schema.encodeEffect(Game.schema(hosted.setup.game))(
            hosted.state,
          ).pipe(Effect.orDie);
          const state = yield* Schema.decodeEffect(Game.schema(setup.game))(encoded).pipe(
            Effect.mapError((issue) => new Unreadable({ reason: issue.message })),
          );
          hosted.setup = { game: setup.game, join: setup.join, leave: setup.leave };
          hosted.inputComponents = inputsOf(setup.game);
          hosted.state = state;
          PubSub.publishUnsafe(happened, { _tag: 'Reloaded', state, ...hosted.setup });
        }),
      restore: (state) =>
        Effect.suspend(() => {
          hosted.state = state;
          hosted.era += 1;
          PubSub.publishUnsafe(happened, { _tag: 'Restored', state });
          return broadcast(state);
        }),
      // Subscribing and reading the state happen with nothing in between, so the first happening told is the first after the state given.
      watch: Effect.map(PubSub.subscribe(happened), (subscription) => ({
        state: hosted.state,
        happenings: Stream.fromSubscription(subscription),
      })),
    };
  });
