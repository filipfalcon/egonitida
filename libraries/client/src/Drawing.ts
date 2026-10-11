import { type Client, type Component, World } from '@lightocean/core';
import { Effect, Option, Schema, type Scope, Stream } from 'effect';
import * as Timeline from '#src/Timeline.ts';

/**
 * What a client draws from, frame by frame: its timeline, fed with every world the client receives. Code that draws, such as a renderer or a game's own imperative code during a migration, reads the world from here and never writes to it.
 *
 * Taking a frame is plain synchronous work, called once per displayed frame: no Effect runs per frame.
 */

/**
 * What to draw this frame, and what changed since the frame before: which entities came into the drawing or left it, so whatever stands for them can be made or put away, and which gained a component, held it anew, or lost it, such as a moment like a hit kept as state, so it can be shown as it happens.
 */
export interface Frame extends Timeline.View {
  readonly entered: ReadonlyArray<World.Entity>;
  readonly left: ReadonlyArray<World.Entity>;
  /** The entities holding `component` now that did not the frame before. */
  readonly gained: (component: Component.Any) => ReadonlyArray<World.Entity>;
  /** The entities that held `component` the frame before and hold another value of it now, as the world drawn has it: a moment such as a hit, kept as state and replaced by the next. */
  readonly changed: (component: Component.Any) => ReadonlyArray<World.Entity>;
  /** The entities that held `component` the frame before and do not now, gone or not. */
  readonly lost: (component: Component.Any) => ReadonlyArray<World.Entity>;
}

export interface Drawing {
  /** Moves drawing on by `seconds` of real time and returns what to draw; called once a frame. */
  readonly frame: (seconds: number) => Option.Option<Frame>;
  /** Plays the past from `from`, in seconds of the world's time, at `rate` times real time, until `live`. */
  readonly present: (options: { readonly from: number; readonly rate: number }) => void;
  /** Returns drawing to the live world. */
  readonly live: () => void;
}

/** The entities of `these` not among `those`. */
const without = (
  these: ReadonlyArray<World.Entity>,
  those: ReadonlyArray<World.Entity>,
): ReadonlyArray<World.Entity> => {
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

/** The entities holding `component` in both worlds, with another value of it in `now` than in `before`. */
const changedBetween = (
  before: World.World,
  now: World.World,
  component: Component.Any,
): ReadonlyArray<World.Entity> => {
  const encode = encoderOf(component);
  return World.query(now, component).flatMap(([entity, value]) =>
    Option.match(World.get(before, entity, component), {
      onNone: () => [],
      onSome: (was) => (was === value || encode(was) === encode(value) ? [] : [entity]),
    }),
  );
};

export const make = (
  client: Client.Client,
  options: { readonly keepSeconds: number },
): Effect.Effect<Drawing, never, Scope.Scope> =>
  Effect.gen(function* () {
    const state = {
      timeline: Timeline.make({ stepRate: client.stepRate, keepSeconds: options.keepSeconds }),
      /** What the last frame drew. */
      previous: Option.none<Timeline.View>(),
    };
    yield* client.worlds.pipe(
      Stream.runForEach((world) =>
        Effect.sync(() => {
          state.timeline = Timeline.receive(state.timeline, world);
        }),
      ),
      Effect.forkScoped,
    );
    return {
      frame: (seconds) => {
        state.timeline = Timeline.advance(state.timeline, seconds);
        return Option.map(Timeline.view(state.timeline), (view) => {
          const previous = state.previous;
          state.previous = Option.some(view);
          const before = Option.match(previous, {
            onNone: () => [],
            onSome: (last) => last.entities,
          });
          const holding = (drawn: Timeline.View, component: Component.Any) =>
            drawn.query(component).map(([entity]) => entity);
          const holdingBefore = (component: Component.Any) =>
            Option.match(previous, {
              onNone: () => [],
              onSome: (last) => holding(last, component),
            });
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
        });
      },
      present: (presentation) => {
        state.timeline = Timeline.present(state.timeline, presentation);
      },
      live: () => {
        state.timeline = Timeline.live(state.timeline);
      },
    };
  });
