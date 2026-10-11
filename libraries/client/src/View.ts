import { type Component, World } from '@lightocean/core';
import { Effect, Exit, Option, Scope } from 'effect';
import * as Three from 'three/webgpu';
import type * as Drawing from '#src/Drawing.ts';

/**
 * How a game draws its world: views over each drawn frame, each by what it is drawn for.
 *
 * | What it is drawn for | View |
 * | --- | --- |
 * | An entity is in the drawing | `each`: builds its objects when the entity comes, draws them every frame, and lets them go when it leaves |
 * | An entity just gained a component, or holds another value of it | `on`: a one-off output that is not state, such as a sound |
 * | A condition holds | `during`: a resource held while it holds, such as music or pointer lock |
 *
 * Whatever a view acquires is released through a `Scope`, never by hand. What a view draws is a function of the frame: it keeps nothing between frames, and what it must remember is a local component instead.
 */

type Of<Value> = Component.Component<string, Value, Component.Owner>;

/** What an entity a view is drawn for holds, of the components the view asks for: every one of them is there. */
export type Held<C extends Component.Any> = <Value>(component: Of<Value> & C) => Value;

export interface Each<R, Built extends Three.Object3D = Three.Object3D> {
  readonly _tag: 'Each';
  readonly components: ReadonlyArray<Component.Any>;
  /** Builds what stands for `entity`, within the scope it is held for. */
  readonly acquire: (
    entity: World.Entity,
    frame: Drawing.Frame,
  ) => Effect.Effect<Built, never, R | Scope.Scope>;
  /** Draws what this view built, as `frame` has the entity; any other object it leaves alone. */
  draw(object: Three.Object3D, entity: World.Entity, frame: Drawing.Frame): void;
  /** `object`, as the type this view built it, if this view built it. */
  own(object: Three.Object3D): Option.Option<Built>;
}

export interface On<R> {
  readonly _tag: 'On';
  readonly component: Component.Any;
  /** What follows from `entity` gaining the component, or holding another value of it. */
  readonly react: (entity: World.Entity, frame: Drawing.Frame) => Effect.Effect<void, never, R>;
}

export interface During<R> {
  readonly _tag: 'During';
  readonly holds: (frame: Drawing.Frame) => boolean;
  readonly acquire: Effect.Effect<unknown, never, R | Scope.Scope>;
}

export type View<R = never> = Each<R, Three.Object3D> | On<R> | During<R>;

/** What `entity` holds in `frame`, of components it is known to hold. */
const heldIn =
  <C extends Component.Any>(frame: Drawing.Frame, entity: World.Entity): Held<C> =>
  <Value>(component: Of<Value> & C): Value =>
    Option.getOrThrow(frame.get<Value>(entity, component));

/**
 * A view for every entity holding all of `components`: `acquire` builds its object when the entity comes into the drawing, `draw` draws it every frame from what the entity holds, and the object is let go when the entity leaves or stops holding any of them. Built anew if it comes back. `draw` changes only its own object, in place, and allocates nothing.
 */
export const each = <
  const Components extends ReadonlyArray<Component.Any>,
  Built extends Three.Object3D,
  R = never,
>(
  components: Components,
  spec: {
    readonly acquire: (
      held: Held<Components[number]>,
      frame: Drawing.Frame,
      entity: World.Entity,
    ) => Effect.Effect<Built, never, R | Scope.Scope>;
    readonly draw: (object: Built, held: Held<Components[number]>, frame: Drawing.Frame) => void;
  },
): Each<R, Built> => {
  // What this view built, as the type it built it: the runner keeps objects of any view, and hands each back to the view that built it.
  const built = new WeakMap<Three.Object3D, Built>();
  const own = (object: Three.Object3D) => Option.fromNullishOr(built.get(object));
  return {
    _tag: 'Each',
    components,
    acquire: (entity, frame) =>
      Effect.map(
        spec.acquire(heldIn<Components[number]>(frame, entity), frame, entity),
        (object) => {
          built.set(object, object);
          return object;
        },
      ),
    draw: (object, entity, frame) =>
      Option.map(own(object), (mine) =>
        spec.draw(mine, heldIn<Components[number]>(frame, entity), frame),
      ),
    own,
  };
};

/** A view that reacts whenever an entity gains `component`, or holds another value of it: a moment such as a hit, shown once as it happens. */
export const on = <Value, R = never>(
  component: Of<Value>,
  react: (
    value: Value,
    frame: Drawing.Frame,
    entity: World.Entity,
  ) => Effect.Effect<void, never, R>,
): View<R> => ({
  _tag: 'On',
  component,
  react: (entity, frame) =>
    Option.match(frame.get(entity, component), {
      onNone: () => Effect.void,
      onSome: (value) => react(value, frame, entity),
    }),
});

/** A view that holds what `acquire` acquires for as long as `holds` says so of the frame drawn. */
export const during = <R = never>(
  holds: (frame: Drawing.Frame) => boolean,
  acquire: Effect.Effect<unknown, never, R | Scope.Scope>,
): View<R> => ({ _tag: 'During', holds, acquire });

/** A game's views at work: their objects under `root`, drawn with every frame. */
export interface Views<R = never> {
  readonly root: Three.Group;
  /** What `view` built for `entity` and draws now, if anything. */
  readonly find: <Built extends Three.Object3D>(
    view: Each<R, Built>,
    entity: World.Entity,
  ) => Option.Option<Built>;
  /** Draws `frame`: builds and lets go of what entities coming and going need, draws every object, and reacts to what just happened. */
  readonly frame: (frame: Drawing.Frame) => Effect.Effect<void, never, R>;
}

interface Kept {
  readonly object: Three.Object3D;
  readonly scope: Scope.Closeable;
}

/** `views` at work, until the scope closes, which lets go of everything they hold. */
export const make = <R = never>(
  views: ReadonlyArray<View<R>>,
): Effect.Effect<Views<R>, never, R | Scope.Scope> =>
  Effect.gen(function* () {
    const root = new Three.Group();
    const scope = yield* Effect.scope;
    // What each `each` view keeps, by entity: its identity is the view and the entity together.
    const kept = new Map<Each<R, Three.Object3D>, Map<World.Entity, Kept>>();
    // The scope each `during` view holds open, while its condition holds.
    const held = new Map<During<R>, Scope.Closeable>();

    const letGo = (keeping: Kept) =>
      Effect.suspend(() => {
        keeping.object.removeFromParent();
        return Scope.close(keeping.scope, Exit.void);
      });

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        for (const keeping of kept.values()) {
          yield* Effect.forEach(keeping.values(), letGo, { discard: true });
        }
        yield* Effect.forEach(held.values(), (open) => Scope.close(open, Exit.void), {
          discard: true,
        });
      }),
    );

    const drawEach = (view: Each<R, Three.Object3D>, frame: Drawing.Frame) =>
      Effect.gen(function* () {
        const keeping = kept.get(view) ?? new Map<World.Entity, Kept>();
        kept.set(view, keeping);
        const now = new Set(World.holding(frame.drawn, view.components));
        for (const [entity, gone] of keeping) {
          if (!now.has(entity)) {
            keeping.delete(entity);
            yield* letGo(gone);
          }
        }
        for (const entity of now) {
          if (!keeping.has(entity)) {
            const own = yield* Scope.fork(scope);
            const object = yield* view.acquire(entity, frame).pipe(Scope.provide(own));
            root.add(object);
            keeping.set(entity, { object, scope: own });
          }
        }
        for (const [entity, { object }] of keeping) {
          view.draw(object, entity, frame);
        }
      });

    const react = (view: On<R>, frame: Drawing.Frame) =>
      Effect.forEach(
        [...frame.gained(view.component), ...frame.changed(view.component)],
        (entity) => Effect.forkIn(view.react(entity, frame), scope),
        { discard: true },
      );

    const hold = (view: During<R>, frame: Drawing.Frame) =>
      Effect.gen(function* () {
        const open = held.get(view);
        const holds = view.holds(frame);
        if (holds && open === undefined) {
          const own = yield* Scope.fork(scope);
          yield* view.acquire.pipe(Scope.provide(own));
          held.set(view, own);
        } else if (!holds && open !== undefined) {
          held.delete(view);
          yield* Scope.close(open, Exit.void);
        }
      });

    return {
      root,
      find: (view, entity) =>
        Option.flatMap(Option.fromNullishOr(kept.get(view)?.get(entity)), ({ object }) =>
          view.own(object),
        ),
      frame: (frame) =>
        Effect.forEach(
          views,
          (view) =>
            view._tag === 'Each'
              ? drawEach(view, frame)
              : view._tag === 'On'
                ? react(view, frame)
                : hold(view, frame),
          { discard: true },
        ),
    };
  });
