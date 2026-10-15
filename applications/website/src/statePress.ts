import { State } from '@nitida/core';
import { Projection, type Session } from '@nitida/foldkit';
import { Effect, Option, Schema, Stream } from 'effect';
import { Command, ManagedResource, Subscription, type Update } from 'foldkit';
import * as Dom from 'foldkit/dom';
import { defineMessageUnion } from 'foldkit/message';
import { modifyFields } from 'foldkit/struct';
import * as Press from '#src/press.ts';
import * as Stepping from '#src/stepping.ts';

/**
 * The state press, the figure that explains a state on the page of key terms: a bench press that stamps states, each a small globe on a carriage with its entities on it, and every step stamps a new one while the earlier ones ride back along the rail, unchanged. The states it shows are those of a game on the engine, `press.ts`, hosted in a worker with its time held; a click asks the game for one step, and the press stamps each state the page is shown.
 */

// STATES

/** One thing on a state's globe: what it is, where on the globe it stands, how far it goes a step, and its health, where it holds them. */
export const Thing = Schema.Struct({
  kind: Schema.Literals(['Tree', 'Volcano', 'Dragon', 'Warrior']),
  longitude: Schema.Finite,
  latitude: Schema.Finite,
  maybeStride: Schema.Option(Schema.Finite),
  maybeHealth: Schema.Option(Schema.Finite),
});
export type Thing = typeof Thing.Type;

/** A state as the press shows it: its tick, its random counter, and the things on its globe, in the order they were spawned. */
export const Stamp = Schema.Struct({
  tick: Schema.Finite,
  random: Schema.Finite,
  things: Schema.Array(Thing),
});
export type Stamp = typeof Stamp.Type;

/** What the press reads off a state of the engine: every thing on its globe, with what it holds. */
export const stampOf = (state: State.State): Stamp => ({
  tick: state.tick,
  random: state.random,
  things: State.query(state, Press.Shape, Press.Position).map(
    ([entity, { kind }, { longitude, latitude }]) => ({
      kind,
      longitude,
      latitude,
      maybeStride: Option.map(State.get(state, entity, Press.Stride), ({ degrees }) => degrees),
      maybeHealth: Option.map(State.get(state, entity, Press.Health), ({ current }) => current),
    }),
  ),
});

/** How many states the rail shows. */
export const SHOWN = 5;

// MODEL

/** The figure's session: being joined, joined, or not to be joined, and why. */
export const PageSession = Schema.Union([
  Schema.TaggedStruct('Joining', {}),
  Schema.TaggedStruct('Joined', {}),
  Schema.TaggedStruct('Failed', { reason: Schema.String }),
]);
export type PageSession = typeof PageSession.Type;

/** The press at rest, or partway through a step, with the state it is stamping. */
export const Pressing = Schema.Union([
  Schema.TaggedStruct('Resting', {}),
  Schema.TaggedStruct('Stepping', { seconds: Schema.Finite, made: Stamp }),
]);
export type Pressing = typeof Pressing.Type;

/** The figure: its session; the states on its rail, oldest first; the states it was shown and has not stamped yet; the press; how many steps it asked for that it has not been shown; the earlier state pointed at, if any; and whether the reader asked for less motion. */
export const Model = Schema.Struct({
  session: PageSession,
  states: Schema.Array(Stamp),
  arrived: Schema.Array(Stamp),
  press: Pressing,
  asked: Schema.Int,
  maybePicked: Schema.Option(Schema.Int),
  motion: Schema.Literals(['Full', 'Reduced']),
});
export type Model = typeof Model.Type;

/** The figure as the page opens: joining its game, with nothing on its rail. */
export const initialModel: Model = {
  session: { _tag: 'Joining' },
  states: [],
  arrived: [],
  press: { _tag: 'Resting' },
  asked: 0,
  maybePicked: Option.none(),
  motion: 'Full',
};

// MESSAGE

/** What happens to the figure: its game joined, left, or not joined; the state asked to be seen; a step asked for and taken; an earlier state chosen, and the state gone back to it; a state shown; a state pointed at or left; a frame drawn; and the reader's wish for motion read. */
export const Message = defineMessageUnion({
  JoinedGame: {},
  LeftGame: {},
  FailedJoinGame: { reason: Schema.String },
  ShowedState: {},
  FailedShowState: { reason: Schema.String },
  RequestedStep: {},
  SteppedGame: {},
  FailedStepGame: { reason: Schema.String },
  ProjectedState: { state: Stamp },
  ChoseState: { index: Schema.Int },
  WentBack: {},
  FailedGoBack: { reason: Schema.String },
  PointedAtState: { index: Schema.Int },
  LeftStates: {},
  ElapsedFrame: { milliseconds: Schema.Finite },
  ChangedMotionPreference: { isReduced: Schema.Boolean },
});
export type Message = typeof Message.Type;

// RESOURCES

/** The press's session, joined while the page of key terms is open. */
export const PressSession = ManagedResource.tag<Session.Joined>()('PressSession');

/** What the figure's Commands and Subscriptions reach: its session. */
export type Services = ManagedResource.ServiceOf<typeof PressSession>;

// COMMANDS

/** Asks the press's game for the state as it stands, which a host whose time is suspended sends no page until it steps. */
export const ShowState = Command.define('ShowState', {
  messages: [Message.ShowedState, Message.FailedShowState],
  execute: PressSession.get.pipe(
    Effect.flatMap(({ client }) => Stepping.show(client)),
    Effect.as(Message.ShowedState()),
    Effect.catch(({ resource }) =>
      Effect.succeed(Message.FailedShowState({ reason: `The session ${resource} is not joined.` })),
    ),
  ),
});

/** Asks the press's game to go back to the state it was at, at `tick`, and step on from there. */
export const GoBack = Command.define('GoBack', {
  args: { tick: Schema.Int },
  messages: [Message.WentBack, Message.FailedGoBack],
  execute: ({ tick }) =>
    PressSession.get.pipe(
      Effect.flatMap(({ client }) => Stepping.goBack(client, tick)),
      Effect.as(Message.WentBack()),
      Effect.catch(({ resource }) =>
        Effect.succeed(Message.FailedGoBack({ reason: `The session ${resource} is not joined.` })),
      ),
    ),
});

/** Asks the press's game for one step. */
export const StepGame = Command.define('StepGame', {
  messages: [Message.SteppedGame, Message.FailedStepGame],
  execute: PressSession.get.pipe(
    Effect.flatMap(({ client }) => Stepping.step(client)),
    Effect.as(Message.SteppedGame()),
    Effect.catch(({ resource }) =>
      Effect.succeed(Message.FailedStepGame({ reason: `The session ${resource} is not joined.` })),
    ),
  ),
});

// STEP

/** How long one step of the press takes, in seconds. */
const SECONDS_PER_STEP = 1.6;

/** The share of a step at which the new state is stamped: the counter, the dial, and the readout turn to it there. */
const STAMPED = 0.5;

/** The most steps asked for and not yet stamped, so a burst of clicks does not run far ahead of the press. */
const MOST_ASKED = 3;

const ease = (share: number) => (share <= 0 ? 0 : share >= 1 ? 1 : share * share * (3 - 2 * share));
const between = (share: number, from: number, to: number) => ease((share - from) / (to - from));

/** Where everything is partway through a step: how far the oldest plate has faded, how far the rest have slid back one slot, how far the press is down, how clear the new plate is, and how far its pegs have risen. */
export interface Pose {
  readonly leaving: number;
  readonly slid: number;
  readonly down: number;
  readonly arriving: number;
  readonly grown: number;
  readonly isStamped: boolean;
}

const RESTING: Pose = { leaving: 0, slid: 0, down: 0, arriving: 0, grown: 0, isStamped: false };

/** The pose of the figure in `model`. */
export const poseOf = (model: Model): Pose => {
  if (model.press._tag === 'Resting') {
    return RESTING;
  }
  const share = model.press.seconds / SECONDS_PER_STEP;
  return {
    leaving: model.states.length < SHOWN ? 0 : between(share, 0, 0.14),
    slid: between(share, 0.08, 0.36),
    down: between(share, 0.36, 0.46) - between(share, 0.54, 0.66),
    arriving: between(share, 0.38, 0.46),
    grown: between(share, STAMPED, 0.8),
    isStamped: share >= STAMPED,
  };
};

const newestOf = (model: Model): Option.Option<Stamp> =>
  Option.fromNullishOr(model.states[model.states.length - 1]);

/** The state the press's counter and dial show: the newest, or the one being stamped once it is, if it has any. */
export const pressedOf = (model: Model): Option.Option<Stamp> =>
  model.press._tag === 'Stepping' && poseOf(model).isStamped
    ? Option.some(model.press.made)
    : newestOf(model);

const componentsOf = (state: Stamp) =>
  state.things.reduce(
    (count, thing) =>
      count +
      2 +
      (Option.isSome(thing.maybeStride) ? 1 : 0) +
      (Option.isSome(thing.maybeHealth) ? 1 : 0),
    0,
  );

/** What the figure says of the state it shows: the one pointed at, or the newest. */
export const readoutOf = (model: Model): string => {
  if (model.session._tag === 'Failed') {
    return `the game cannot be joined: ${model.session.reason}`;
  }
  const picked = Option.flatMap(model.maybePicked, (index) =>
    Option.fromNullishOr(model.states[index]),
  );
  return Option.match(
    Option.orElse(picked, () => pressedOf(model)),
    {
      onNone: () => 'joining the game',
      onSome: (state) =>
        Option.isSome(picked) && Option.getOrUndefined(newestOf(model)) !== state
          ? `state at tick ${state.tick} · kept as it was`
          : `state at tick ${state.tick} · ${state.things.length} entities · ${componentsOf(state)} components`,
    },
  );
};

// UPDATE

/** The press set to stamp the first state waiting, if it rests and one waits. */
const stampNext = (model: Model): Model => {
  const [made, ...rest] = model.arrived;
  return model.press._tag === 'Resting' && made !== undefined
    ? modifyFields(model, {
        press: (): Pressing => ({ _tag: 'Stepping', seconds: 0, made }),
        arrived: () => rest,
        maybePicked: () => Option.none(),
      })
    : model;
};

const onRail = (states: ReadonlyArray<Stamp>, state: Stamp) => [...states, state].slice(-SHOWN);

/** The figure shown `state`: the first on its rail, the next to stamp, or, from a host gone back in time, the first again. */
const shown = (model: Model, state: Stamp): Model => {
  // A page holds an empty state until its host sends it one, and no state of the press's is empty.
  if (state.things.length === 0) {
    return model;
  }
  const asked = Math.max(0, model.asked - 1);
  const last = model.arrived[model.arrived.length - 1] ?? Option.getOrUndefined(newestOf(model));
  // A state from before the last one is the host gone back in time: the rail keeps what came before it, which the host still went through, and loses what came after.
  if (last === undefined || state.tick < last.tick) {
    return modifyFields(model, {
      states: (states) => [...states.filter(({ tick }) => tick < state.tick), state].slice(-SHOWN),
      arrived: () => [],
      press: (): Pressing => ({ _tag: 'Resting' }),
      asked: () => asked,
      maybePicked: () => Option.none(),
    });
  }
  // A state told again at the same tick, such as the host's own in place of the empty one a page starts with, takes the place of the one it had.
  if (state.tick === last.tick) {
    return model.arrived.length > 0
      ? modifyFields(model, { arrived: (arrived) => [...arrived.slice(0, -1), state] })
      : modifyFields(model, { states: (states) => [...states.slice(0, -1), state] });
  }
  if (model.motion === 'Reduced') {
    return modifyFields(model, { states: (states) => onRail(states, state), asked: () => asked });
  }
  return stampNext(
    modifyFields(model, { arrived: (arrived) => [...arrived, state], asked: () => asked }),
  );
};

type Return = Update.Return<Model, Message, Services>;

/** The figure after `message`. */
export const update = (model: Model, message: Message): Return =>
  Message.match<Return>(message, {
    JoinedGame: () => ({
      model: modifyFields(model, { session: (): PageSession => ({ _tag: 'Joined' }) }),
      commands: [ShowState()],
    }),
    LeftGame: () => ({
      model: modifyFields(model, {
        session: (): PageSession => ({ _tag: 'Joining' }),
        asked: () => 0,
      }),
    }),
    FailedJoinGame: ({ reason }) => ({
      model: modifyFields(model, { session: (): PageSession => ({ _tag: 'Failed', reason }) }),
    }),
    // Asked for only once the game is joined, and only so far ahead of what the press has stamped.
    RequestedStep: () =>
      model.session._tag === 'Joined' && model.asked + model.arrived.length < MOST_ASKED
        ? { model: modifyFields(model, { asked: (asked) => asked + 1 }), commands: [StepGame()] }
        : { model },
    ShowedState: () => ({ model }),
    FailedShowState: () => ({ model }),
    SteppedGame: () => ({ model }),
    // Only an earlier state, while the rail stands still, is gone back to; the newest is where the game already is.
    ChoseState: ({ index }) => {
      const chosen = model.states[index];
      return model.session._tag === 'Joined' &&
        model.press._tag === 'Resting' &&
        chosen !== undefined &&
        index < model.states.length - 1
        ? { model, commands: [GoBack({ tick: chosen.tick })] }
        : { model };
    },
    WentBack: () => ({ model }),
    FailedGoBack: () => ({ model }),
    FailedStepGame: () => ({
      model: modifyFields(model, { asked: (asked) => Math.max(0, asked - 1) }),
    }),
    ProjectedState: ({ state }) => ({ model: shown(model, state) }),
    // A plate is pointed at only while the rail stands still, as a sliding one is not where it was.
    PointedAtState: ({ index }) => ({
      model:
        model.press._tag === 'Resting' && index >= 0 && index < model.states.length
          ? modifyFields(model, { maybePicked: () => Option.some(index) })
          : model,
    }),
    LeftStates: () => ({ model: modifyFields(model, { maybePicked: () => Option.none() }) }),
    // A frame after a long pause, as when the tab was hidden, moves the press no further than a short one.
    ElapsedFrame: ({ milliseconds }) => {
      const press = model.press;
      if (press._tag === 'Resting') {
        return { model };
      }
      const seconds = press.seconds + Math.min(milliseconds, 50) / 1000;
      return {
        model:
          seconds < SECONDS_PER_STEP
            ? modifyFields(model, {
                press: (): Pressing => ({ _tag: 'Stepping', seconds, made: press.made }),
              })
            : stampNext(
                modifyFields(model, {
                  states: (states) => onRail(states, press.made),
                  press: (): Pressing => ({ _tag: 'Resting' }),
                }),
              ),
      };
    },
    ChangedMotionPreference: ({ isReduced }) => ({
      model: modifyFields(model, { motion: () => (isReduced ? 'Reduced' : 'Full') }),
    }),
  });

// SUBSCRIPTIONS

/** Every state the press's game is shown, while it is joined; frames while the press is stepping; and the reader's wish for less motion, read as the page opens and whenever it changes. */
export const subscriptions = Subscription.make<Model, Message, Services>()((entry) => ({
  states: entry(
    { isJoined: Schema.Boolean },
    {
      modelToDependencies: ({ session }) => ({ isJoined: session._tag === 'Joined' }),
      dependenciesToStream: ({ isJoined }) =>
        isJoined
          ? Projection.stream({
              resource: PressSession,
              schema: Stamp,
              project: stampOf,
              onProjected: (state): Message => Message.ProjectedState({ state }),
              onNotJoined: (): Message => Message.LeftGame(),
            })
          : Stream.empty,
    },
  ),
  frames: Subscription.animationFrameEntry({
    isActive: (model: Model) => model.press._tag === 'Stepping',
    toMessage: (milliseconds) => Message.ElapsedFrame({ milliseconds }),
  }),
  motion: entry(
    {},
    {
      modelToDependencies: () => ({}),
      dependenciesToStream: () =>
        Dom.streamFromMediaQuery({
          query: '(prefers-reduced-motion: reduce)',
          mapMatches: (isReduced): Message => Message.ChangedMotionPreference({ isReduced }),
        }),
    },
  ),
}));
