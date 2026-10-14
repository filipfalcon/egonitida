import { type Component, State } from '@lightocean/core';
import { Effect, Exit, Fiber, Option, Scope } from 'effect';
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
 * | Many entities together, or none | `whole`: one object, drawn every frame from the whole frame, such as one light for every fire |
 * | A value outside the drawing follows the state, time and all | `follow`: worked out every frame, and put out as it changes, such as a pad's lightbar |
 * | The player looks at the game | `rig`: the camera, drawn for the player after every other view, from what they drew |
 *
 * Whatever a view acquires is released through a `Scope`, never by hand. What a view draws is a function of the frame and of the drawing's input, y = h(x, v): what changes only how the game is drawn for this player, such as through whose eyes the camera looks, which the page keeps and hands the views at every frame rather than the state holding it. A view keeps nothing between frames, and what it must remember is a local component instead.
 */

type Of<Value> = Component.Component<string, Value, Component.Owner>;

/** What an entity a view is drawn for holds, of the components the view asks for: every one of them is there. */
export type Held<C extends Component.Any> = <Value>(component: Of<Value> & C) => Value;

/**
 * What a view for every entity holding all of `Components` is written as, given to `each`: `acquire` builds what stands for an entity as it comes into the drawing, given what the entity holds, the frame, and the entity, in that order; and `draw` draws it every frame, given what it built, what the entity holds, the frame, and the drawing's input.
 */
export interface EachSpec<
  Components extends ReadonlyArray<Component.Any>,
  Built extends Three.Object3D,
  R,
  V = unknown,
> {
  readonly acquire: (
    held: Held<Components[number]>,
    frame: Drawing.Frame,
    entity: State.Entity,
  ) => Effect.Effect<Built, never, R | Scope.Scope>;
  readonly draw: (
    object: Built,
    held: Held<Components[number]>,
    frame: Drawing.Frame,
    input: V,
  ) => void;
}

/**
 * A view for every entity holding all of `components`, as the views at work call it: made by `each` from an `EachSpec`, which is what a view is written as. Its functions take the entity where the spec's take what it holds, which they work out from it.
 */
export interface Each<R, Built extends Three.Object3D = Three.Object3D, V = unknown> {
  readonly _tag: 'Each';
  readonly components: ReadonlyArray<Component.Any>;
  /** Builds what stands for `entity`, within the scope it is held for, by the spec's `acquire`, given what `entity` holds in `frame`, the frame, and the entity. */
  readonly acquire: (
    entity: State.Entity,
    frame: Drawing.Frame,
  ) => Effect.Effect<Built, never, R | Scope.Scope>;
  /** Draws what this view built, as `frame` has the entity, with the drawing's `input`, by the spec's `draw`; any other object it leaves alone. */
  readonly draw: (
    object: Three.Object3D,
    entity: State.Entity,
    frame: Drawing.Frame,
    input: V,
  ) => void;
  /** `object`, as the type this view built it, if this view built it. */
  own(object: Three.Object3D): Option.Option<Built>;
}

export interface On<R> {
  readonly _tag: 'On';
  readonly component: Component.Any;
  /** What follows from `entity` gaining the component, or holding another value of it. */
  readonly react: (entity: State.Entity, frame: Drawing.Frame) => Effect.Effect<void, never, R>;
}

export interface During<R, V = unknown> {
  readonly _tag: 'During';
  readonly when: (frame: Drawing.Frame, input: V) => boolean;
  readonly acquire: Effect.Effect<unknown, never, R | Scope.Scope>;
}

/** What `view` drew for `entity` this frame, if anything. */
export type Drawn = <Built extends Three.Object3D>(
  view: Each<unknown, Built, never>,
  entity: State.Entity,
) => Option.Option<Built>;

/** The camera drawn for the player, as the views at work call it: made by `rig`, whose `draw` is written to take what the player's entity holds where this one takes the entity itself. */
export interface Rig<V = unknown> {
  readonly _tag: 'Rig';
  readonly components: ReadonlyArray<Component.Any>;
  /** Draws `camera` for the player's `entity`, which holds every one of `components`, after every other view has drawn `frame`, with the drawing's `input`, by the `draw` given to `rig`, given what `entity` holds. */
  readonly draw: (
    camera: Three.PerspectiveCamera,
    entity: State.Entity,
    frame: Drawing.Frame,
    drawn: Drawn,
    input: V,
  ) => void;
}

export interface Whole<R, Built extends Three.Object3D = Three.Object3D, V = unknown> {
  readonly _tag: 'Whole';
  /** Builds what this view draws, at the first frame, within the scope of the views. */
  readonly acquire: (frame: Drawing.Frame) => Effect.Effect<Built, never, R | Scope.Scope>;
  /** Draws what this view built, from the whole of `frame` and the drawing's `input`. */
  readonly draw: (object: Three.Object3D, frame: Drawing.Frame, input: V) => void;
  /** `object`, as the type this view built it, if this view built it. */
  own(object: Three.Object3D): Option.Option<Built>;
}

/** What a `follow` view worked out of a frame, told apart by identity alone. */
export type Followed = object;

export interface Follow<R, V = unknown> {
  readonly _tag: 'Follow';
  /** What follows from `frame` and the drawing's `input`, given what followed from the frame before, if one was drawn: it now, and what puts it out, if it is another. */
  readonly next: (
    frame: Drawing.Frame,
    input: V,
    before: Option.Option<Followed>,
  ) => { readonly now: Followed; readonly put: Option.Option<Effect.Effect<void, never, R>> };
}

/** A view of the game, needing what `R` names to draw and, as the drawing's input, a `V`: any, unless it reads one. */
export type View<R = never, V = unknown> =
  | Each<R, Three.Object3D, V>
  | On<R>
  | During<R, V>
  | Whole<R, Three.Object3D, V>
  | Follow<R, V>
  | Rig<V>;

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
  V = unknown,
>(
  components: Components,
  spec: EachSpec<Components, Built, R, V>,
): Each<R, Built, V> => {
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
    draw: (object, entity, frame, input) =>
      Option.map(own(object), (mine) =>
        spec.draw(mine, heldIn<Components[number]>(frame, entity), frame, input),
      ),
    own,
  };
};

/**
 * A view of the whole frame rather than of one entity: `acquire` builds its object at the first frame, `draw` draws it every frame from everything the frame holds, such as one light for every fire burning, and the object is let go when the views are. `draw` changes only its own object, in place, and allocates nothing.
 */
export const whole = <Built extends Three.Object3D, R = never, V = unknown>(spec: {
  readonly acquire: (frame: Drawing.Frame) => Effect.Effect<Built, never, R | Scope.Scope>;
  readonly draw: (object: Built, frame: Drawing.Frame, input: V) => void;
}): Whole<R, Built, V> => {
  const built = new WeakMap<Three.Object3D, Built>();
  const own = (object: Three.Object3D) => Option.fromNullishOr(built.get(object));
  return {
    _tag: 'Whole',
    acquire: (frame) =>
      Effect.map(spec.acquire(frame), (object) => {
        built.set(object, object);
        return object;
      }),
    draw: (object, frame, input) =>
      Option.map(own(object), (mine) => spec.draw(mine, frame, input)),
    own,
  };
};

/**
 * A view of a value outside the drawing that follows the state, time and all, such as a pad's lightbar as bright as a heartbeat flares it: `of` works it out of every frame, and `to` puts it out at the first frame and then only as it changes, `same` telling one value from another, by identity unless told. `of` is plain code, as a view's `draw` is, and keeps nothing between frames.
 */
export const follow = <A, R = never, V = unknown>(spec: {
  readonly of: (frame: Drawing.Frame, input: V) => A;
  readonly to: (value: A) => Effect.Effect<void, never, R>;
  readonly same?: (a: A, b: A) => boolean;
}): Follow<R, V> => {
  const same = spec.same ?? Object.is;
  // What each frame's token stands for: the value worked out of it.
  const values = new WeakMap<Followed, A>();
  return {
    _tag: 'Follow',
    next: (frame, input, before) => {
      const value = spec.of(frame, input);
      const now: Followed = {};
      values.set(now, value);
      const changed = !Option.exists(
        Option.flatMap(before, (token) => Option.fromNullishOr(values.get(token))),
        (was) => same(was, value),
      );
      return { now, put: changed ? Option.some(spec.to(value)) : Option.none() };
    },
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
export const during = <R = never, V = unknown>(
  when: (frame: Drawing.Frame, input: V) => boolean,
  acquire: Effect.Effect<unknown, never, R | Scope.Scope>,
): During<R, V> => ({ _tag: 'During', when, acquire });

/**
 * The camera, drawn for the player whose entity holds all of `components`: after every other view has drawn the frame, so `drawn` gives what they drew this frame, such as the body whose eyes it looks out of. Rigs draw one after another in the order they are given, so one can move the camera on from where another put it, as a shake does. `draw` changes only the camera, in place, and allocates nothing; what it must remember, such as where the player looks or how far behind the camera trails, is a local component.
 */
export const rig = <const Components extends ReadonlyArray<Component.Any>, V = unknown>(
  components: Components,
  draw: (
    camera: Three.PerspectiveCamera,
    held: Held<Components[number]>,
    frame: Drawing.Frame,
    drawn: Drawn,
    input: V,
  ) => void,
): Rig<V> => ({
  _tag: 'Rig',
  components,
  draw: (camera, entity, frame, drawn, input) =>
    draw(camera, heldIn<Components[number]>(frame, entity), frame, drawn, input),
});

/** What is under a point of the screen: the entity whose object is nearest there, the view that drew it, and where it was hit, in the scene. */
export interface Picked {
  readonly entity: State.Entity;
  readonly view: Each<unknown, Three.Object3D, never>;
  readonly point: Three.Vector3;
}

/** A game's views at work: their objects under `root`, drawn with every frame. */
export interface Views<R = never> {
  readonly root: Three.Group;
  /** What `view` built for `entity` and draws now, if anything. */
  readonly find: <Built extends Three.Object3D>(
    view: Each<unknown, Built, never>,
    entity: State.Entity,
  ) => Option.Option<Built>;
  /**
   * What is under `point` of the screen, seen through `camera`, as the objects were last drawn: the entity of the nearest object an `each` view built, and the view, if one is there. Only meshes are hit, so a line or a sprite drawn over a scene never takes a click; what is nearest decides, so an object in front blocks one behind it. `point` runs from -1 to 1 across the screen and up it, as Three.js's normalized device coordinates do.
   */
  readonly pick: (
    camera: Three.Camera,
    point: { readonly x: number; readonly y: number },
  ) => Option.Option<Picked>;
  /** What the view of the whole frame `view` built and draws now, once it has drawn a frame. */
  readonly whole: <Built extends Three.Object3D>(
    view: Whole<unknown, Built, never>,
  ) => Option.Option<Built>;
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

/**
 * `views` at work, until the scope closes, which lets go of everything they hold. Each view is given its own scope for what it acquires, so a frame needs no scope of its own. Their rigs draw `looking`'s camera for its player; with no one looking, none is drawn.
 *
 * At every frame they are given the drawing's input, as `input` gives it then: what the page keeps of how the game is drawn for its player, such as through whose eyes the camera looks. Views that read none need none given.
 */
export function make<const Given extends ReadonlyArray<View<unknown, undefined>>>(
  views: Given,
  looking?: Option.Option<Looking>,
): Effect.Effect<Views<Exclude<NeedsOf<Given>, Scope.Scope>>, never, NeedsOf<Given> | Scope.Scope>;
export function make<const Given extends ReadonlyArray<View<unknown, V>>, V>(
  views: Given,
  looking: Option.Option<Looking>,
  input: () => V,
): Effect.Effect<Views<Exclude<NeedsOf<Given>, Scope.Scope>>, never, NeedsOf<Given> | Scope.Scope>;
export function make<R, V>(
  views: ReadonlyArray<View<R, V | undefined>>,
  looking: Option.Option<Looking> = Option.none(),
  input: () => V | undefined = () => undefined,
): Effect.Effect<Views<Exclude<R, Scope.Scope>>, never, R | Scope.Scope> {
  return working(views, looking, input);
}

/** What one view reads as the drawing's input, as a function that takes it, so the inputs of many views meet in one. */
type ReaderOf<One> = One extends View<unknown, infer V> ? (input: V) => void : never;

/** The drawing's input `views` read together: what every one of them reads, met in one value, such as where the player looks for a rig and how bright the page draws for another view; anything, where none reads one. A page that works the input out, such as a stage playing it on with its devices every frame, gives a value of it, typed by the views rather than by what it works it out with. */
export type InputOf<Given extends ReadonlyArray<View<unknown, never>>> = [
  ReaderOf<Given[number]>,
] extends [(input: infer V) => void]
  ? V
  : never;

/** What one view needs to draw: what it names, and nothing for a rig, which names nothing. */
type NeedOf<One> = One extends Rig<never> ? never : One extends View<infer R, never> ? R : never;

/** What `views` need to draw, together: all that each of them needs, so views that need different services are drawn together with nothing named. */
export type NeedsOf<Given extends ReadonlyArray<View<unknown, never>>> = NeedOf<Given[number]>;

/** `views` at work, given the drawing's input as `asked` gives it at every frame. */
const working = <R, V>(
  views: ReadonlyArray<View<R, V>>,
  looking: Option.Option<Looking>,
  asked: () => V,
): Effect.Effect<Views<Exclude<R, Scope.Scope>>, never, R | Scope.Scope> =>
  Effect.gen(function* () {
    const root = new Three.Group();
    const scope = yield* Effect.scope;
    // What each `each` view keeps, by entity: its identity is the view and the entity together.
    const kept = new Map<object, Map<State.Entity, Kept>>();
    // Which view built each object, and for which entity, so a hit object leads back to them.
    const owners = new WeakMap<
      Three.Object3D,
      { readonly view: Each<R, Three.Object3D, V>; readonly entity: State.Entity }
    >();
    const raycaster = new Three.Raycaster();
    // The scope each `during` view holds open, while its condition is true.
    const held = new Map<During<R, V>, Scope.Closeable>();
    // What each view of the whole frame built, once it has drawn one.
    const wholes = new Map<object, Three.Object3D>();
    // What each `follow` view worked out of the frame before, and what it is
    // putting out, so each value goes out after the one before it.
    const followed = new Map<Follow<R, V>, Followed>();
    const putting = new Map<Follow<R, V>, Fiber.Fiber<void>>();

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

    const drawEach = (view: Each<R, Three.Object3D, V>, frame: Drawing.Frame, given: V) =>
      Effect.gen(function* () {
        const keeping = kept.get(view) ?? new Map<State.Entity, Kept>();
        kept.set(view, keeping);
        const now = new Set(State.entitiesHolding(frame.drawn, view.components));
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
          view.draw(object, entity, frame, given);
        }
      });

    const drawWhole = (view: Whole<R, Three.Object3D, V>, frame: Drawing.Frame, given: V) =>
      Effect.gen(function* () {
        const known = wholes.get(view);
        const object = known ?? (yield* view.acquire(frame).pipe(Scope.provide(scope)));
        if (known === undefined) {
          wholes.set(view, object);
          root.add(object);
        }
        view.draw(object, frame, given);
      });

    const follow = (view: Follow<R, V>, frame: Drawing.Frame, given: V) =>
      Effect.suspend(() => {
        const { now, put } = view.next(frame, given, Option.fromNullishOr(followed.get(view)));
        followed.set(view, now);
        return Option.match(put, {
          onNone: () => Effect.void,
          onSome: (effect) => {
            const after = Option.match(Option.fromNullishOr(putting.get(view)), {
              onNone: () => effect,
              onSome: (before) => Effect.andThen(Fiber.join(before), effect),
            });
            return Effect.map(Effect.forkIn(Scope.provide(after, scope), scope), (fiber) => {
              putting.set(view, fiber);
            });
          },
        });
      });

    const react = (view: On<R>, frame: Drawing.Frame) =>
      Effect.forEach(
        [...frame.gained(view.component), ...frame.changed(view.component)],
        (entity) => Effect.forkIn(Scope.provide(view.react(entity, frame), scope), scope),
        { discard: true },
      );

    const hold = (view: During<R, V>, frame: Drawing.Frame, given: V) =>
      Effect.gen(function* () {
        const open = held.get(view);
        const wanted = view.when(frame, given);
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
      readonly view: Each<R, Three.Object3D, V>;
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
    const rigs = views.filter((view): view is Rig<V> => view._tag === 'Rig');

    const drawRigs = (frame: Drawing.Frame, given: V) =>
      Option.map(looking, ({ camera, player }) => {
        for (const rig of rigs) {
          if (rig.components.every((component) => Option.isSome(frame.get(player, component)))) {
            rig.draw(camera, player, frame, drawn, given);
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
      whole: (view) =>
        Option.flatMap(Option.fromNullishOr(wholes.get(view)), (object) => view.own(object)),
      frame: (frame) =>
        Effect.suspend(() => {
          // The drawing's input as it is at this frame, the same for every view.
          const given = asked();
          return Effect.andThen(
            Effect.forEach(
              views,
              (view) =>
                view._tag === 'Each'
                  ? drawEach(view, frame, given)
                  : view._tag === 'On'
                    ? react(view, frame)
                    : view._tag === 'During'
                      ? hold(view, frame, given)
                      : view._tag === 'Whole'
                        ? drawWhole(view, frame, given)
                        : view._tag === 'Follow'
                          ? follow(view, frame, given)
                          : Effect.void,
              { discard: true },
            ),
            Effect.sync(() => drawRigs(frame, given)),
          );
        }),
    };
  });
