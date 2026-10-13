import { Effect, Option, Schema, SchemaGetter, SchemaIssue } from 'effect';
import type * as Component from '#src/Component.ts';

/**
 * A state is an immutable value that records one tick: the entities that exist, the components they hold, and the counter for the next entity id, and the seed its randomness is drawn from.
 *
 * The host holds a state with every component, private ones included; a client holds the last state it received from the host, plus its own local components and, with prediction, its player's predicted components; a snapshot carries the part of the host's state that travels.
 *
 * A state is never changed, only replaced: on the host, by a step, a player joining or leaving, or a restore or reload; on a client, by a newly received state, a local step, or a prediction step. The state replaced is left as it was, so any past one can be kept for a replay or a rewind.
 *
 * Each component keeps its own store, and only it can read the values in it, so nothing here claims what type a value has. Storage is naive for now: correct first, fast once something real measures it.
 */

export type Entity = Component.Entity;

type Stores = ReadonlyMap<string, Component.Store>;

/** A state: its tick, its counters, and the store of every component it holds. */
export interface State {
  readonly tick: number;
  readonly nextEntity: Entity;
  /** The id the next entity a client spawns for itself gets: they count down from -1, so they never meet the server's, which count up from 0. */
  readonly nextLocal: Entity;
  /** The seed every part of a step draws its own stream of numbers from, with the tick; no step changes it. */
  readonly random: number;
  readonly stores: Stores;
}

export const empty = (options: { readonly seed: number }): State => ({
  tick: 0,
  nextEntity: 0,
  nextLocal: -1,
  random: options.seed >>> 0,
  stores: new Map(),
});

/** Anything holding stores: a state, or a draft of the next one. */
export interface Readable {
  readonly stores: Stores;
}

type Of<Value> = Component.Component<string, Value, Component.Owner>;

export const get = <Value>(
  state: Readable,
  entity: Entity,
  component: Of<Value>,
): Option.Option<Value> => component.read(state.stores.get(component.name), entity);

/** Every entity holding all of `components`, in the order the entities were spawned. */
export const holding = (
  state: Readable,
  components: ReadonlyArray<Component.Any>,
): ReadonlyArray<Entity> => {
  const stores = components.map((component) => state.stores.get(component.name));
  const [first, ...rest] = stores;
  if (first === undefined || rest.some((store) => store === undefined)) {
    return [];
  }
  return [...first.entities()]
    .filter((entity) => rest.every((store) => store?.has(entity)))
    .sort((a, b) => a - b);
};

/** Every entity holding anything at all, in the order the entities were spawned. */
export const entities = (state: Readable): ReadonlyArray<Entity> =>
  [...new Set([...state.stores.values()].flatMap((store) => [...store.entities()]))].sort(
    (a, b) => a - b,
  );

/**
 * A query over the components in `Allowed`, giving each entity holding all the components asked for, with their values. TypeScript cannot turn an array of values into a typed tuple, so there is one signature per number of components, up to six, the way Bevy writes one per tuple length.
 */
export interface Query<Allowed extends Component.Any> {
  /** Carries `Allowed` so that a query over some components is no query over others, even passed on to a helper; never set. */
  readonly '~allowed'?: (allowed: Allowed) => void;
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
 * A query over entities `select` picks, with the values `read` gives them: over a state, or over anything that holds entities the way a state does, such as a frame drawn between two states.
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

/** The query over everything in `state`. */
export const queryIn = (state: Readable): Query<Component.Any> =>
  queryBy(
    (components) => holding(state, components),
    (entity, component) => get(state, entity, component),
  );

/** Every entity in `state` holding all of `components`, with their values, in the order the entities were spawned. */
export function query<A>(state: Readable, a: Of<A>): ReadonlyArray<readonly [Entity, A]>;
export function query<A, B>(
  state: Readable,
  a: Of<A>,
  b: Of<B>,
): ReadonlyArray<readonly [Entity, A, B]>;
export function query<A, B, C>(
  state: Readable,
  a: Of<A>,
  b: Of<B>,
  c: Of<C>,
): ReadonlyArray<readonly [Entity, A, B, C]>;
export function query<A, B, C, D>(
  state: Readable,
  a: Of<A>,
  b: Of<B>,
  c: Of<C>,
  d: Of<D>,
): ReadonlyArray<readonly [Entity, A, B, C, D]>;
export function query<A, B, C, D, E>(
  state: Readable,
  a: Of<A>,
  b: Of<B>,
  c: Of<C>,
  d: Of<D>,
  e: Of<E>,
): ReadonlyArray<readonly [Entity, A, B, C, D, E]>;
export function query<A, B, C, D, E, F>(
  state: Readable,
  a: Of<A>,
  b: Of<B>,
  c: Of<C>,
  d: Of<D>,
  e: Of<E>,
  f: Of<F>,
): ReadonlyArray<readonly [Entity, A, B, C, D, E, F]>;
export function query(
  state: Readable,
  ...components: ReadonlyArray<Component.Any>
): ReadonlyArray<ReadonlyArray<unknown>> {
  return holding(state, components).map((entity) => [
    entity,
    ...components.map((component) => Option.getOrUndefined(get(state, entity, component))),
  ]);
}

export const spawn = (
  state: State,
  instances: ReadonlyArray<Component.Instance>,
): readonly [State, Entity] => {
  const entity = state.nextEntity;
  const stores = new Map(state.stores);
  for (const instance of instances) {
    const name = instance.component.name;
    stores.set(name, instance.into(stores.get(name), entity));
  }
  return [{ ...state, nextEntity: entity + 1, stores }, entity];
};

export const despawn = (state: State, entity: Entity): State => {
  const stores = new Map(state.stores);
  for (const [name, store] of state.stores) {
    if (store.has(entity)) {
      stores.set(name, store.without(entity));
    }
  }
  return { ...state, stores };
};

// DRAFTS
//
// A step works on a draft: a copy of a state that the step may change in place, which copies a component's store only the first time the step writes to it. Finishing the draft gives the next state, and the state the step began from is never touched.

export interface Draft {
  tick: number;
  nextEntity: Entity;
  nextLocal: Entity;
  random: number;
  readonly stores: Map<string, Component.Store>;
  /** The stores this step has copied so far, by the component that owns each; only that component can change one. */
  readonly copies: Map<Component.Any, Component.Store>;
}

export const draft = (state: State): Draft => ({
  tick: state.tick,
  nextEntity: state.nextEntity,
  nextLocal: state.nextLocal,
  random: state.random,
  stores: new Map(state.stores),
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

/** Spawns an entity into a draft, with the next id, and gives the id. */
export const spawnInto = (draft: Draft, instances: ReadonlyArray<Component.Instance>): Entity => {
  const entity = draft.nextEntity;
  draft.nextEntity += 1;
  for (const instance of instances) {
    instance.writeWith((component, value) => write(draft, entity, component, value));
  }
  return entity;
};

/** Spawns an entity a client keeps for itself into a draft, with the next local id, and gives the id. */
export const spawnLocalInto = (
  draft: Draft,
  instances: ReadonlyArray<Component.Instance>,
): Entity => {
  const entity = draft.nextLocal;
  draft.nextLocal -= 1;
  for (const instance of instances) {
    instance.writeWith((component, value) => write(draft, entity, component, value));
  }
  return entity;
};

/** Whether `entity` is one a client spawned for itself. */
export const isLocal = (entity: Entity): boolean => entity < 0;

/** Takes an entity out of every store of a draft. Its id is never given out again. */
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

/**
 * The state a draft finishes as; every store the step copied is sealed, so nothing can change it afterwards. Every value of the components in `freeze` is frozen too, so changing one in place throws: a guard for development, which costs a walk over the state.
 */
export const finish = (draft: Draft, freeze: ReadonlyArray<Component.Any> = []): State => {
  for (const [component, copy] of draft.copies) {
    component.seal(copy);
  }
  for (const component of freeze) {
    const store = draft.stores.get(component.name);
    if (store !== undefined) {
      component.freeze(store);
    }
  }
  return {
    tick: draft.tick,
    nextEntity: draft.nextEntity,
    nextLocal: draft.nextLocal,
    random: draft.random,
    stores: new Map(draft.stores),
  };
};

// ENCODING

/** A state as its schema encodes it: its tick, its counters, and the values of every component it holds, by entity. */
const Encoded = Schema.Struct({
  tick: Schema.Int,
  nextEntity: Schema.Int,
  nextLocal: Schema.Int,
  random: Schema.Int,
  stores: Schema.Record(Schema.String, Schema.Array(Schema.Tuple([Schema.Int, Schema.Unknown]))),
});

const isState = (value: unknown): value is State =>
  typeof value === 'object' &&
  value !== null &&
  'tick' in value &&
  typeof value.tick === 'number' &&
  'nextEntity' in value &&
  typeof value.nextEntity === 'number' &&
  'nextLocal' in value &&
  typeof value.nextLocal === 'number' &&
  'random' in value &&
  typeof value.random === 'number' &&
  'stores' in value &&
  value.stores instanceof Map;

/**
 * The schema of a state made of `components`: each component's values travel encoded by its own schema. A state that holds a component not among them does not decode, nor does one with a value its component cannot decode, so nothing reaches a state that its game would not have put there.
 */
export const schema = (components: ReadonlyArray<Component.Any>) => {
  const byName = new Map(components.map((component) => [component.name, component]));
  return Encoded.pipe(
    Schema.decodeTo(Schema.declare(isState), {
      decode: SchemaGetter.transformEffect((encoded, options) =>
        Option.match(
          Option.all(
            Object.entries(encoded.stores).map(([name, entries]) =>
              Option.flatMap(Option.fromNullishOr(byName.get(name)), (component) =>
                Option.map(component.decode(entries), (store) => [name, store] as const),
              ),
            ),
          ),
          {
            onNone: () =>
              Effect.fail(
                new SchemaIssue.InvalidValue(
                  { message: 'a component its game does not hold, or a value it cannot decode' },
                  encoded,
                  options,
                ),
              ),
            onSome: (stores) =>
              Effect.succeed<State>({
                tick: encoded.tick,
                nextEntity: encoded.nextEntity,
                nextLocal: encoded.nextLocal,
                random: encoded.random,
                stores: new Map(stores),
              }),
          },
        ),
      ),
      encode: SchemaGetter.transform((state: State) => ({
        tick: state.tick,
        nextEntity: state.nextEntity,
        nextLocal: state.nextLocal,
        random: state.random,
        stores: Object.fromEntries(
          components.flatMap((component) => {
            const store = state.stores.get(component.name);
            return store === undefined ? [] : [[component.name, component.encode(store)] as const];
          }),
        ),
      })),
    }),
  );
};
