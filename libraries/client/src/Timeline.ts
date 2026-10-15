import type { Component } from '@egonitida/core';
import { State } from '@egonitida/core';
import { Option } from 'effect';
import * as Interpolate from '#src/Interpolate.ts';

/**
 * A client's timeline: the states it received lately, and where among them it draws. The live game goes on regardless of what is drawn, so drawing can lag a step behind to move smoothly between states, or play a past moment at its own pace for a presentation such as a killcam, and return.
 *
 * It keeps no clock of its own: it is told how much real time passed, so it behaves the same wherever it runs.
 */

/** Drawing follows the live state, or plays the past at a pace of its own. */
export type Playback =
  | { readonly _tag: 'Live' }
  | { readonly _tag: 'Presenting'; readonly rate: number };

export interface Timeline {
  readonly stepRate: number;
  /** How far back states are kept, in seconds of the game's time. */
  readonly keepSeconds: number;
  /** The states received, oldest first. */
  readonly history: ReadonlyArray<State.State>;
  /** Where drawing is, in seconds of the game's time. */
  readonly cursor: number;
  readonly playback: Playback;
}

/** What to draw at the cursor. */
export interface View {
  /** The tick drawn, between two whole ticks while drawing moves between states. */
  readonly tick: number;
  /** The value `entity` has where drawing is, between the two states around it. */
  readonly get: <Value>(
    entity: State.Entity,
    component: Component.Component<string, Value, Component.Owner>,
  ) => Option.Option<Value>;
  /** Every entity drawn holding all of the components asked for, each with its values as `get` gives them. */
  readonly query: State.Query<Component.Any>;
  /** Every entity drawn, in the order they were spawned. */
  readonly entities: ReadonlyArray<State.Entity>;
  /** The state that says what is drawn: which entities there are and what each holds, before anything is moved between states. */
  readonly drawn: State.State;
}

// While live, drawing keeps one step behind the newest state, so there is always a state to move toward.
const DELAY_STEPS = 1;
// Drawing moves at most this much faster or slower than real time to keep its place, so it never visibly lurches.
const MAX_ADJUST = 0.02;
// How strongly drawing leans toward its place: the share of real time added per second it is off.
const LEAN = 1;
// Further behind than this, drawing jumps ahead instead, as when a client first joins or a presentation ends.
const JUMP_SECONDS = 0.25;

export const make = (options: {
  readonly stepRate: number;
  readonly keepSeconds: number;
}): Timeline => ({
  stepRate: options.stepRate,
  keepSeconds: options.keepSeconds,
  history: [],
  cursor: 0,
  playback: { _tag: 'Live' },
});

const timeOf = (timeline: Timeline, state: State.State) => state.tick / timeline.stepRate;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** The span of the game's time the kept states cover; `None` before the first. */
const span = (timeline: Timeline) => {
  const oldest = timeline.history.at(0);
  const newest = timeline.history.at(-1);
  return oldest === undefined || newest === undefined
    ? Option.none()
    : Option.some({ oldest: timeOf(timeline, oldest), newest: timeOf(timeline, newest) });
};

/**
 * Keeps `state`, and forgets what has grown older than kept states are. A state no newer than every state kept is one the host went back to, since a client hands on no state that arrived late: drawing starts over from it, at once.
 */
export const receive = (timeline: Timeline, state: State.State): Timeline => {
  const newest = timeline.history.at(-1);
  if (newest !== undefined && state.tick <= newest.tick) {
    return { ...timeline, history: [state], cursor: timeOf(timeline, state) };
  }
  const since = timeOf(timeline, state) - timeline.keepSeconds;
  const history = [...timeline.history, state].filter((kept) => timeOf(timeline, kept) >= since);
  return {
    ...timeline,
    history,
    // The first state is drawn as soon as it arrives.
    cursor: newest === undefined ? timeOf(timeline, state) : timeline.cursor,
  };
};

/** Moves drawing on by `seconds` of real time. */
export const elapse = (timeline: Timeline, seconds: number): Timeline =>
  Option.match(span(timeline), {
    onNone: () => timeline,
    onSome: ({ oldest, newest }) => {
      if (timeline.playback._tag === 'Presenting') {
        return {
          ...timeline,
          cursor: clamp(timeline.cursor + seconds * timeline.playback.rate, oldest, newest),
        };
      }
      const target = clamp(newest - DELAY_STEPS / timeline.stepRate, oldest, newest);
      if (target - timeline.cursor > JUMP_SECONDS) {
        return { ...timeline, cursor: target };
      }
      // How far from its place drawing would be after moving at real time, and the pace that leans it back.
      const off = target - (timeline.cursor + seconds);
      const rate = 1 + clamp(off * LEAN, -MAX_ADJUST, MAX_ADJUST);
      // Never past the newest state: with nothing newer, drawing waits rather than guesses.
      return { ...timeline, cursor: clamp(timeline.cursor + seconds * rate, oldest, newest) };
    },
  });

/** Plays the past from `from`, in seconds of the game's time, at `rate` times real time, until `live`. */
export const present = (
  timeline: Timeline,
  options: { readonly from: number; readonly rate: number },
): Timeline => ({
  ...timeline,
  cursor: Option.match(span(timeline), {
    onNone: () => options.from,
    onSome: ({ oldest, newest }) => clamp(options.from, oldest, newest),
  }),
  playback: { _tag: 'Presenting', rate: options.rate },
});

/** Returns drawing to the live state. */
export const live = (timeline: Timeline): Timeline => ({
  ...timeline,
  playback: { _tag: 'Live' },
});

/** `state` drawn as it is, with nothing to move toward: for drawing one state on its own, as a test of what is drawn does. */
export const still = (state: State.State): View => ({
  tick: state.tick,
  get: (entity, component) => State.get(state, entity, component),
  query: State.queryIn(state),
  entities: State.entities(state),
  drawn: state,
});

/** What to draw at the cursor; `None` before the first state. */
export const view = (timeline: Timeline): Option.Option<View> => {
  const [first] = timeline.history;
  if (first === undefined) {
    return Option.none();
  }
  // The last state at or before the cursor, and the one after it, if any.
  const index = timeline.history.findLastIndex(
    (state) => timeOf(timeline, state) <= timeline.cursor + 1e-9,
  );
  const earlier = timeline.history[Math.max(index, 0)] ?? first;
  const later = index < 0 ? undefined : timeline.history[index + 1];
  const t =
    later === undefined
      ? 0
      : (timeline.cursor - timeOf(timeline, earlier)) /
        (timeOf(timeline, later) - timeOf(timeline, earlier));
  // Which state says what is drawn: an entity appears or leaves once the state that brings it or takes it away is reached, as `get` has it.
  const drawn = later !== undefined && t >= 1 ? later : earlier;
  const get: View['get'] = (entity, component) => {
    const before = State.get(earlier, entity, component);
    if (later === undefined || t <= 0) {
      return before;
    }
    const after = State.get(later, entity, component);
    if (t >= 1) {
      return after;
    }
    // Present in both states, it moves between them; appearing or leaving, it does so once the later state is reached.
    return Option.isSome(before) && Option.isSome(after)
      ? Option.some(Interpolate.between(component.schema, before.value, after.value, t))
      : before;
  };
  return Option.some({
    tick: later === undefined ? earlier.tick : earlier.tick + t * (later.tick - earlier.tick),
    get,
    query: State.queryBy((components) => State.entitiesHolding(drawn, components), get),
    entities: State.entities(drawn),
    drawn,
  });
};
