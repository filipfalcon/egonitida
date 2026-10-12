import { type Client, type Component, State } from '@lightocean/core';
import { Effect, Option, Schema, type Scope, Stream } from 'effect';
import * as Timeline from '#src/Timeline.ts';

/**
 * What a client draws from, frame by frame: its timeline, fed with every state the client receives. Code that draws, such as a renderer or a game's own imperative code during a migration, reads the state from here and never writes to it.
 *
 * Taking a frame is plain synchronous work, called once per displayed frame: no Effect runs per frame.
 */

/**
 * What to draw this frame, and what changed since the frame before: which entities came into the drawing or left it, so whatever stands for them can be made or put away, and which gained a component, held it anew, or lost it, such as a moment like a hit kept as a component, so it can be shown as it happens.
 */
export interface Frame extends Timeline.View {
  readonly entered: ReadonlyArray<State.Entity>;
  readonly left: ReadonlyArray<State.Entity>;
  /** The entities holding `component` now that did not the frame before. */
  readonly gained: (component: Component.Any) => ReadonlyArray<State.Entity>;
  /** The entities that held `component` the frame before and hold another value of it now, as the state drawn has it: a moment such as a hit, kept as a component and replaced by the next. */
  readonly changed: (component: Component.Any) => ReadonlyArray<State.Entity>;
  /** The entities that held `component` the frame before and do not now, gone or not. */
  readonly lost: (component: Component.Any) => ReadonlyArray<State.Entity>;
}

export interface Drawing {
  /** Moves drawing on by `seconds` of real time and returns what to draw; called once a frame. */
  readonly frame: (seconds: number) => Option.Option<Frame>;
  /** Plays the past from `from`, in seconds of the game's time, at `rate` times real time, until `live`. */
  readonly present: (options: { readonly from: number; readonly rate: number }) => void;
  /** Returns drawing to the live state. */
  readonly live: () => void;
}

/** The entities of `these` not among `those`. */
const without = (
  these: ReadonlyArray<State.Entity>,
  those: ReadonlyArray<State.Entity>,
): ReadonlyArray<State.Entity> => {
  const excluded = new Set(those);
  return these.filter((entity) => !excluded.has(entity));
};

// A component's values as JSON, made once for each component, to tell one value of it from another.
const encoders = new WeakMap<Component.Any, (value: unknown) => string>();

const encoderOf = (component: Component.Any) => {
  const known = encoders.get(component);
  if (known !== undefined) {
    return known;
  }
  const encode = Schema.encodeUnknownSync(
    Schema.fromJsonString(Schema.toCodecJson(component.schema)),
  );
  encoders.set(component, encode);
  return encode;
};

/** The entities holding `component` in both states, with another value of it in `now` than in `before`. */
const changedBetween = (
  before: State.State,
  now: State.State,
  component: Component.Any,
): ReadonlyArray<State.Entity> => {
  const encode = encoderOf(component);
  return State.query(now, component).flatMap(([entity, value]) =>
    Option.match(State.get(before, entity, component), {
      onNone: () => [],
      onSome: (was) => (was === value || encode(was) === encode(value) ? [] : [entity]),
    }),
  );
};

/** `view` as a frame drawn after `previous`, the view of the frame before, if there was one. */
export const frameOf = (view: Timeline.View, previous: Option.Option<Timeline.View>): Frame => {
  const before = Option.match(previous, { onNone: () => [], onSome: (last) => last.entities });
  const holding = (drawn: Timeline.View, component: Component.Any) =>
    drawn.query(component).map(([entity]) => entity);
  const holdingBefore = (component: Component.Any) =>
    Option.match(previous, { onNone: () => [], onSome: (last) => holding(last, component) });
  return {
    ...view,
    entered: without(view.entities, before),
    left: without(before, view.entities),
    gained: (component) => without(holding(view, component), holdingBefore(component)),
    changed: (component) =>
      Option.match(previous, {
        onNone: () => [],
        onSome: (last) => changedBetween(last.drawn, view.drawn, component),
      }),
    lost: (component) => without(holdingBefore(component), holding(view, component)),
  };
};

export const make = (
  client: Client.Client,
  options: { readonly keepSeconds: number },
): Effect.Effect<Drawing, never, Scope.Scope> =>
  Effect.gen(function* () {
    const seen = {
      timeline: Timeline.make({ stepRate: client.stepRate, keepSeconds: options.keepSeconds }),
      /** What the last frame drew. */
      previous: Option.none<Timeline.View>(),
    };
    yield* client.states.pipe(
      Stream.runForEach((state) =>
        Effect.sync(() => {
          seen.timeline = Timeline.receive(seen.timeline, state);
        }),
      ),
      Effect.forkScoped,
    );
    return {
      frame: (seconds) => {
        seen.timeline = Timeline.elapse(seen.timeline, seconds);
        return Option.map(Timeline.view(seen.timeline), (view) => {
          const drawn = frameOf(view, seen.previous);
          seen.previous = Option.some(view);
          return drawn;
        });
      },
      present: (presentation) => {
        seen.timeline = Timeline.present(seen.timeline, presentation);
      },
      live: () => {
        seen.timeline = Timeline.live(seen.timeline);
      },
    };
  });
