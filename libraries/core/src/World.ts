import { Option } from 'effect';
import type * as Component from '#src/Component.ts';

/**
 * Everything a game holds at one tick: its entities and their components, and the state of its randomness. A world is never changed in place; stepping or spawning makes a new one and leaves the old one as it was, so any past world can be kept for a replay or a rewind.
 *
 * Storage is deliberately naive for now: a map of entities per component. It is correct first and fast later, once something real measures it.
 */

export type Entity = number;

type Stores = ReadonlyMap<string, ReadonlyMap<Entity, unknown>>;

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
interface Readable {
  readonly stores: Stores;
}

export const get = <C extends Component.Any>(
  world: Readable,
  entity: Entity,
  component: C,
): Option.Option<Component.ValueOf<C>> => {
  const store = world.stores.get(component.name);
  return store !== undefined && store.has(entity)
    ? Option.some(store.get(entity) as Component.ValueOf<C>)
    : Option.none();
};

/** Every entity holding all of `components`, with their values, in the order the entities were spawned. */
export const query = <const Cs extends ReadonlyArray<Component.Any>>(
  world: Readable,
  ...components: Cs
): ReadonlyArray<readonly [Entity, ...Component.ValuesOf<Cs>]> => {
  const stores = components.map((component) => world.stores.get(component.name));
  const [first, ...rest] = stores;
  if (first === undefined || rest.some((store) => store === undefined)) {
    return [];
  }
  return [...first.keys()]
    .filter((entity) => rest.every((store) => store?.has(entity)))
    .sort((a, b) => a - b)
    .map(
      (entity) =>
        [entity, ...stores.map((store) => store?.get(entity))] as unknown as readonly [
          Entity,
          ...Component.ValuesOf<Cs>,
        ],
    );
};

export const spawn = (
  world: World,
  instances: ReadonlyArray<Component.Instance>,
): readonly [World, Entity] => {
  const entity = world.nextEntity;
  const stores = new Map(world.stores);
  for (const { component, value } of instances) {
    stores.set(component.name, new Map(stores.get(component.name)).set(entity, value));
  }
  return [{ ...world, nextEntity: entity + 1, stores }, entity];
};

export const despawn = (world: World, entity: Entity): World => {
  const stores = new Map(world.stores);
  for (const [name, store] of world.stores) {
    if (store.has(entity)) {
      const without = new Map(store);
      without.delete(entity);
      stores.set(name, without);
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
  readonly stores: Map<string, ReadonlyMap<Entity, unknown>>;
  readonly copied: Set<string>;
}

export const draft = (world: World): Draft => ({
  tick: world.tick,
  nextEntity: world.nextEntity,
  random: world.random,
  stores: new Map(world.stores),
  copied: new Set(),
});

export const write = (
  draft: Draft,
  entity: Entity,
  component: Component.Any,
  value: unknown,
): void => {
  if (!draft.copied.has(component.name)) {
    draft.stores.set(component.name, new Map(draft.stores.get(component.name)));
    draft.copied.add(component.name);
  }
  (draft.stores.get(component.name) as Map<Entity, unknown>).set(entity, value);
};

export const finish = (draft: Draft): World => ({
  tick: draft.tick,
  nextEntity: draft.nextEntity,
  random: draft.random,
  stores: new Map(draft.stores),
});
