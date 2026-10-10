import { Option } from 'effect';
import type * as Component from '#src/Component.ts';

/**
 * Everything a game holds at one tick: its entities and their components, and the state of its randomness. A world is never changed in place; stepping or spawning makes a new one and leaves the old one as it was, so any past world can be kept for a replay or a rewind.
 *
 * Each component keeps its own store, and only it can read the values in it, so nothing here claims what type a value has. Storage is naive for now: correct first, fast once something real measures it.
 */

export type Entity = Component.Entity;

type Stores = ReadonlyMap<string, Component.Store>;

export interface World {
  readonly tick: number;
  readonly nextEntity: Entity;
  /** The state of the world's random generator. */
  readonly random: number;
  readonly stores: Stores;
}

export const empty = (options: { readonly seed: number }): World => ({
  tick: 0,
  nextEntity: 0,
  random: options.seed >>> 0,
  stores: new Map(),
});

/** Anything holding stores: a world, or a world being stepped. */
export interface Readable {
  readonly stores: Stores;
}

type Of<Value> = Component.Component<string, Value, Component.Owner>;

export const get = <Value>(
  world: Readable,
  entity: Entity,
  component: Of<Value>,
): Option.Option<Value> => component.read(world.stores.get(component.name), entity);

/** Every entity holding all of `components`, in the order the entities were spawned. */
export const holding = (
  world: Readable,
  components: ReadonlyArray<Component.Any>,
): ReadonlyArray<Entity> => {
  const stores = components.map((component) => world.stores.get(component.name));
  const [first, ...rest] = stores;
  if (first === undefined || rest.some((store) => store === undefined)) {
    return [];
  }
  return [...first.entities()]
    .filter((entity) => rest.every((store) => store?.has(entity)))
    .sort((a, b) => a - b);
};

/** Every entity holding anything at all, in the order the entities were spawned. */
export const entities = (world: Readable): ReadonlyArray<Entity> =>
  [...new Set([...world.stores.values()].flatMap((store) => [...store.entities()]))].sort(
    (a, b) => a - b,
  );

/**
 * A query over the components in `Allowed`, giving each entity holding all the components asked for, with their values. TypeScript cannot turn an array of values into a typed tuple, so there is one signature per number of components, up to six, the way Bevy writes one per tuple length.
 */
export interface Query<Allowed extends Component.Any> {
  <A>(a: Of<A> & Allowed): ReadonlyArray<readonly [Entity, A]>;
  <A, B>(a: Of<A> & Allowed, b: Of<B> & Allowed): ReadonlyArray<readonly [Entity, A, B]>;
  <A, B, C>(
    a: Of<A> & Allowed,
    b: Of<B> & Allowed,
    c: Of<C> & Allowed,
  ): ReadonlyArray<readonly [Entity, A, B, C]>;
  <A, B, C, D>(
    a: Of<A> & Allowed,
    b: Of<B> & Allowed,
    c: Of<C> & Allowed,
    d: Of<D> & Allowed,
  ): ReadonlyArray<readonly [Entity, A, B, C, D]>;
  <A, B, C, D, E>(
    a: Of<A> & Allowed,
    b: Of<B> & Allowed,
    c: Of<C> & Allowed,
    d: Of<D> & Allowed,
    e: Of<E> & Allowed,
  ): ReadonlyArray<readonly [Entity, A, B, C, D, E]>;
  <A, B, C, D, E, F>(
    a: Of<A> & Allowed,
    b: Of<B> & Allowed,
    c: Of<C> & Allowed,
    d: Of<D> & Allowed,
    e: Of<E> & Allowed,
    f: Of<F> & Allowed,
  ): ReadonlyArray<readonly [Entity, A, B, C, D, E, F]>;
}

/**
 * A query over entities `select` picks, with the values `read` gives them: over a world, or over anything that holds entities the way a world does, such as a world drawn between two others.
 */
export const queryBy = (
  select: (components: ReadonlyArray<Component.Any>) => ReadonlyArray<Entity>,
  read: <Value>(entity: Entity, component: Of<Value>) => Option.Option<Value>,
): Query<Component.Any> => {
  function query<A>(a: Of<A>): ReadonlyArray<readonly [Entity, A]>;
  function query<A, B>(a: Of<A>, b: Of<B>): ReadonlyArray<readonly [Entity, A, B]>;
  function query<A, B, C>(a: Of<A>, b: Of<B>, c: Of<C>): ReadonlyArray<readonly [Entity, A, B, C]>;
  function query<A, B, C, D>(
    a: Of<A>,
    b: Of<B>,
    c: Of<C>,
    d: Of<D>,
  ): ReadonlyArray<readonly [Entity, A, B, C, D]>;
  function query<A, B, C, D, E>(
    a: Of<A>,
    b: Of<B>,
    c: Of<C>,
    d: Of<D>,
    e: Of<E>,
  ): ReadonlyArray<readonly [Entity, A, B, C, D, E]>;
  function query<A, B, C, D, E, F>(
    a: Of<A>,
    b: Of<B>,
    c: Of<C>,
    d: Of<D>,
    e: Of<E>,
    f: Of<F>,
  ): ReadonlyArray<readonly [Entity, A, B, C, D, E, F]>;
  // The values come from `read`, in the order the components were asked for, which is what each signature above promises.
  function query(
    ...components: ReadonlyArray<Component.Any>
  ): ReadonlyArray<ReadonlyArray<unknown>> {
    return select(components).map((entity) => [
      entity,
      ...components.map((component) => Option.getOrUndefined(read(entity, component))),
    ]);
  }
  return query;
};

/** The query over everything in `world`. */
export const queryIn = (world: Readable): Query<Component.Any> =>
  queryBy(
    (components) => holding(world, components),
    (entity, component) => get(world, entity, component),
  );

/** Every entity in `world` holding all of `components`, with their values, in the order the entities were spawned. */
export function query<A>(world: Readable, a: Of<A>): ReadonlyArray<readonly [Entity, A]>;
export function query<A, B>(
  world: Readable,
  a: Of<A>,
  b: Of<B>,
): ReadonlyArray<readonly [Entity, A, B]>;
export function query<A, B, C>(
  world: Readable,
  a: Of<A>,
  b: Of<B>,
  c: Of<C>,
): ReadonlyArray<readonly [Entity, A, B, C]>;
export function query<A, B, C, D>(
  world: Readable,
  a: Of<A>,
  b: Of<B>,
  c: Of<C>,
  d: Of<D>,
): ReadonlyArray<readonly [Entity, A, B, C, D]>;
export function query<A, B, C, D, E>(
  world: Readable,
  a: Of<A>,
  b: Of<B>,
  c: Of<C>,
  d: Of<D>,
  e: Of<E>,
): ReadonlyArray<readonly [Entity, A, B, C, D, E]>;
export function query<A, B, C, D, E, F>(
  world: Readable,
  a: Of<A>,
  b: Of<B>,
  c: Of<C>,
  d: Of<D>,
  e: Of<E>,
  f: Of<F>,
): ReadonlyArray<readonly [Entity, A, B, C, D, E, F]>;
export function query(
  world: Readable,
  ...components: ReadonlyArray<Component.Any>
): ReadonlyArray<ReadonlyArray<unknown>> {
  return holding(world, components).map((entity) => [
    entity,
    ...components.map((component) => Option.getOrUndefined(get(world, entity, component))),
  ]);
}

export const spawn = (
  world: World,
  instances: ReadonlyArray<Component.Instance>,
): readonly [World, Entity] => {
  const entity = world.nextEntity;
  const stores = new Map(world.stores);
  for (const instance of instances) {
    const name = instance.component.name;
    stores.set(name, instance.into(stores.get(name), entity));
  }
  return [{ ...world, nextEntity: entity + 1, stores }, entity];
};

export const despawn = (world: World, entity: Entity): World => {
  const stores = new Map(world.stores);
  for (const [name, store] of world.stores) {
    if (store.has(entity)) {
      stores.set(name, store.without(entity));
    }
  }
  return { ...world, stores };
};

// DRAFTS
//
// A step works on a draft: a world it may change in place, which copies a component's store only the first time the step writes to it. Finishing the draft gives the new world, and the world the step began from is never touched.

export interface Draft {
  tick: number;
  nextEntity: Entity;
  random: number;
  readonly stores: Map<string, Component.Store>;
  /** The stores this step has copied so far, by the component that owns each; only that component can change one. */
  readonly copies: Map<Component.Any, Component.Store>;
}

export const draft = (world: World): Draft => ({
  tick: world.tick,
  nextEntity: world.nextEntity,
  random: world.random,
  stores: new Map(world.stores),
  copies: new Map(),
});

export const write = <Value>(
  draft: Draft,
  entity: Entity,
  component: Of<Value>,
  value: Value,
): void => {
  const existing = draft.copies.get(component);
  const copy = existing ?? component.draft(draft.stores.get(component.name));
  if (existing === undefined) {
    draft.copies.set(component, copy);
    draft.stores.set(component.name, copy);
  }
  component.set(copy, entity, value);
};

/** Spawns an entity into a world being stepped, with the next id, and gives the id. */
export const spawnInto = (draft: Draft, instances: ReadonlyArray<Component.Instance>): Entity => {
  const entity = draft.nextEntity;
  draft.nextEntity += 1;
  for (const instance of instances) {
    instance.writeWith((component, value) => write(draft, entity, component, value));
  }
  return entity;
};

/** Takes an entity out of every store of a world being stepped. Its id is never given out again. */
export const despawnFrom = (draft: Draft, entity: Entity): void => {
  for (const [name, store] of draft.stores) {
    if (!store.has(entity)) continue;
    const copied = [...draft.copies].find(([component]) => component.name === name);
    if (copied === undefined) {
      draft.stores.set(name, store.without(entity));
    } else {
      const [component, copy] = copied;
      component.remove(copy, entity);
    }
  }
};

/** The finished world; every store the step copied is sealed, so nothing can change it afterwards. */
export const finish = (draft: Draft): World => {
  for (const [component, copy] of draft.copies) {
    component.seal(copy);
  }
  return {
    tick: draft.tick,
    nextEntity: draft.nextEntity,
    random: draft.random,
    stores: new Map(draft.stores),
  };
};
