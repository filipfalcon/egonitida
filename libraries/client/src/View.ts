import { type Component, State } from '@lightocean/core';
import { Effect, Exit, Option, Scope } from 'effect';
import * as Three from 'three/webgpu';
import type * as Drawing from '#src/Drawing.ts';

/**
 * How a game draws its state: views over each drawn frame, each by what it is drawn for.
 *
 * | What it is drawn for | View |
 * | --- | --- |
 * | An entity is in the drawing | `each`: builds its objects when the entity comes, draws them every frame, and lets them go when it leaves |
 * | An entity just gained a component, or holds another value of it | `on`: a one-off output that is not part of the state, such as a sound |
 * | A condition is true | `during`: a resource held while `when` is true, such as music or pointer lock |
 * | The player looks at the game | `rig`: the camera, drawn for the player after every other view, from what they drew |
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
    entity: State.Entity,
    frame: Drawing.Frame,
  ) => Effect.Effect<Built, never, R | Scope.Scope>;
  /** Draws what this view built, as `frame` has the entity; any other object it leaves alone. */
  draw(object: Three.Object3D, entity: State.Entity, frame: Drawing.Frame): void;
  /** `object`, as the type this view built it, if this view built it. */
  own(object: Three.Object3D): Option.Option<Built>;
}

export interface On<R> {
  readonly _tag: 'On';
  readonly component: Component.Any;
  /** What follows from `entity` gaining the component, or holding another value of it. */
  readonly react: (entity: State.Entity, frame: Drawing.Frame) => Effect.Effect<void, never, R>;
}

export interface During<R> {
  readonly _tag: 'During';
  readonly when: (frame: Drawing.Frame) => boolean;
  readonly acquire: Effect.Effect<unknown, never, R | Scope.Scope>;
}

/** What `view` drew for `entity` this frame, if anything. */
export type Drawn = <Built extends Three.Object3D>(
  view: Each<unknown, Built>,
  entity: State.Entity,
) => Option.Option<Built>;

export interface Rig {
  readonly _tag: 'Rig';
  readonly components: ReadonlyArray<Component.Any>;
  /** Draws `camera` for the player's `entity`, which holds every one of `components`, after every other view has drawn `frame`. */
  draw(
    camera: Three.PerspectiveCamera,
    entity: State.Entity,
    frame: Drawing.Frame,
    drawn: Drawn,
  ): void;
}

export type View<R = never> = Each<R, Three.Object3D> | On<R> | During<R> | Rig;

/** What `entity` holds in `frame`, of components it is known to hold. */
const heldIn =
  <C extends Component.Any>(frame: Drawing.Frame, entity: State.Entity): Held<C> =>
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
      entity: State.Entity,
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
    entity: State.Entity,
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

/** A view that holds what `acquire` acquires for as long as `when` is true of the frame drawn: a resource held while `when` is true. */
export const during = <R = never>(
  when: (frame: Drawing.Frame) => boolean,
  acquire: Effect.Effect<unknown, never, R | Scope.Scope>,
): View<R> => ({ _tag: 'During', when, acquire });

/**
 * The camera, drawn for the player whose entity holds all of `components`: after every other view has drawn the frame, so `drawn` gives what they drew this frame, such as the body whose eyes it looks out of. Rigs draw one after another in the order they are given, so one can move the camera on from where another put it, as a shake does. `draw` changes only the camera, in place, and allocates nothing; what it must remember, such as where the player looks or how far behind the camera trails, is a local component.
 */
export const rig = <const Components extends ReadonlyArray<Component.Any>>(
  components: Components,
  draw: (
    camera: Three.PerspectiveCamera,
    held: Held<Components[number]>,
    frame: Drawing.Frame,
    drawn: Drawn,
  ) => void,
): View<never> => ({
  _tag: 'Rig',
  components,
  draw: (camera, entity, frame, drawn) =>
    draw(camera, heldIn<Components[number]>(frame, entity), frame, drawn),
});

/** What is under a point of the screen: the entity whose object is nearest there, the view that drew it, and where it was hit, in the scene. */
export interface Picked {
  readonly entity: State.Entity;
  readonly view: Each<unknown, Three.Object3D>;
  readonly point: Three.Vector3;
}

/** A game's views at work: their objects under `root`, drawn with every frame. */
export interface Views<R = never> {
  readonly root: Three.Group;
  /** What `view` built for `entity` and draws now, if anything. */
  readonly find: <Built extends Three.Object3D>(
    view: Each<unknown, Built>,
    entity: State.Entity,
  ) => Option.Option<Built>;
  /**
   * What is under `point` of the screen, seen through `camera`, as the objects were last drawn: the entity of the nearest object an `each` view built, and the view, if one is there. Only meshes are hit, so a line or a sprite drawn over a scene never takes a click; what is nearest decides, so an object in front blocks one behind it. `point` runs from -1 to 1 across the screen and up it, as Three.js's normalized device coordinates do.
   */
  readonly pick: (
    camera: Three.Camera,
    point: { readonly x: number; readonly y: number },
  ) => Option.Option<Picked>;
  /** Every object the views built for `entity` and draw now, in the order of the views. */
  readonly objectsOf: (entity: State.Entity) => ReadonlyArray<Three.Object3D>;
  /** Draws `frame`: builds and lets go of what entities coming and going need, draws every object, and reacts to what just happened. */
  readonly frame: (frame: Drawing.Frame) => Effect.Effect<void, never, R>;
}

interface Kept {
  readonly object: Three.Object3D;
  readonly scope: Scope.Closeable;
}

/** Whose eyes the views' rigs draw the camera for, and the camera they draw. */
export interface Looking {
  readonly camera: Three.PerspectiveCamera;
  readonly player: State.Entity;
}

/** `views` at work, until the scope closes, which lets go of everything they hold. Each view is given its own scope for what it acquires, so a frame needs no scope of its own. Their rigs draw `looking`'s camera for its player; with no one looking, none is drawn. */
export const make = <R = never>(
  views: ReadonlyArray<View<R>>,
  looking: Option.Option<Looking> = Option.none(),
): Effect.Effect<Views<Exclude<R, Scope.Scope>>, never, R | Scope.Scope> =>
  Effect.gen(function* () {
    const root = new Three.Group();
    const scope = yield* Effect.scope;
    // What each `each` view keeps, by entity: its identity is the view and the entity together.
    const kept = new Map<object, Map<State.Entity, Kept>>();
    // Which view built each object, and for which entity, so a hit object leads back to them.
    const owners = new WeakMap<
      Three.Object3D,
      { readonly view: Each<R, Three.Object3D>; readonly entity: State.Entity }
    >();
    const raycaster = new Three.Raycaster();
    // The scope each `during` view holds open, while its condition is true.
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
        const keeping = kept.get(view) ?? new Map<State.Entity, Kept>();
        kept.set(view, keeping);
        const now = new Set(State.holding(frame.drawn, view.components));
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
            owners.set(object, { view, entity });
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
        (entity) => Effect.forkIn(Scope.provide(view.react(entity, frame), scope), scope),
        { discard: true },
      );

    const hold = (view: During<R>, frame: Drawing.Frame) =>
      Effect.gen(function* () {
        const open = held.get(view);
        const wanted = view.when(frame);
        if (wanted && open === undefined) {
          const own = yield* Scope.fork(scope);
          yield* view.acquire.pipe(Scope.provide(own));
          held.set(view, own);
        } else if (!wanted && open !== undefined) {
          held.delete(view);
          yield* Scope.close(open, Exit.void);
        }
      });

    /** The view and entity of the object an each view built that `hit` is, or is part of. */
    const ownerOf = (
      hit: Three.Object3D | null,
    ): Option.Option<{
      readonly view: Each<R, Three.Object3D>;
      readonly entity: State.Entity;
    }> => {
      if (hit === null || hit === root) {
        return Option.none();
      }
      const owner = owners.get(hit);
      return owner === undefined ? ownerOf(hit.parent) : Option.some(owner);
    };

    const drawn: Drawn = (view, entity) =>
      Option.flatMap(Option.fromNullishOr(kept.get(view)?.get(entity)), ({ object }) =>
        view.own(object),
      );
    const rigs = views.filter((view): view is Rig => view._tag === 'Rig');

    const drawRigs = (frame: Drawing.Frame) =>
      Option.map(looking, ({ camera, player }) => {
        for (const rig of rigs) {
          if (rig.components.every((component) => Option.isSome(frame.get(player, component)))) {
            rig.draw(camera, player, frame, drawn);
          }
        }
      });

    return {
      root,
      pick: (camera, point) => {
        root.updateMatrixWorld(true);
        camera.updateMatrixWorld();
        raycaster.setFromCamera(new Three.Vector2(point.x, point.y), camera);
        const nearest = raycaster
          .intersectObject(root, true)
          .find(({ object }) => object instanceof Three.Mesh);
        return Option.flatMap(Option.fromNullishOr(nearest), (hit) =>
          Option.map(ownerOf(hit.object), ({ view, entity }) => ({
            entity,
            view,
            point: hit.point,
          })),
        );
      },
      objectsOf: (entity) =>
        views.flatMap((view) =>
          view._tag === 'Each'
            ? Option.toArray(Option.fromNullishOr(kept.get(view)?.get(entity))).map(
                ({ object }) => object,
              )
            : [],
        ),
      find: drawn,
      frame: (frame) =>
        Effect.andThen(
          Effect.forEach(
            views,
            (view) =>
              view._tag === 'Each'
                ? drawEach(view, frame)
                : view._tag === 'On'
                  ? react(view, frame)
                  : view._tag === 'During'
                    ? hold(view, frame)
                    : Effect.void,
            { discard: true },
          ),
          Effect.sync(() => drawRigs(frame)),
        ),
    };
  });
