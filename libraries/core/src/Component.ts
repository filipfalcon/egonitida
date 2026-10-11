import { Option, Schema } from 'effect';

/**
 * A kind of data an entity can hold, described by a Schema. A component is the unit of ownership: all of it is changed by one owner and travels the network one way. When part of something needs another owner, it is another component.
 *
 * A component also keeps its own values. A store it makes holds values only it put there, so reading one back needs no claim about its type: the component's own code is the proof.
 */

/** An entity is only an id; everything it has is in its components. */
export type Entity = number;

/**
 * Who may change a component: the rules, through events; the systems, every step; or the players, whose input the engine writes at the start of a step and nothing else may.
 */
export type Owner = 'rules' | 'simulation' | 'input';

/**
 * How a component travels: decided by the server and sent to every client; guessed by a client and confirmed by the server; kept on the client alone; or kept on the server alone, for what a client does not need, builds for itself, or must not see.
 */
export type NetworkRole = 'server' | 'predicted' | 'local' | 'private';

/** One component's values by entity. Only the component that made a store can read the values in it. */
export interface Store {
  readonly has: (entity: Entity) => boolean;
  readonly entities: () => IterableIterator<Entity>;
  /** The store without `entity`. */
  readonly without: (entity: Entity) => Store;
}

/** Puts a value of a component somewhere, whatever its type: how an instance hands on the value it keeps. */
export type Writer = <Value>(component: Component<string, Value, Owner>, value: Value) => void;

/** A component holding a value, ready to be given to an entity; `C` is the component, so what may be spawned can be checked. */
export interface Instance<C extends Any = Any> {
  readonly component: C;
  /** `store` with `entity` holding this value. */
  readonly into: (store: Store | undefined, entity: Entity) => Store;
  /** Hands the value to `write`, with the component it belongs to. */
  readonly writeWith: (write: Writer) => void;
  /** This value, encoded by its component's schema. */
  readonly encoded: () => unknown;
}

/**
 * Methods rather than function properties wherever a parameter is the component's value: TypeScript checks a method's parameters both ways, so a component of a particular value still fits where any component is accepted.
 */
export interface Component<
  Name extends string,
  Value,
  O extends Owner,
  N extends NetworkRole = NetworkRole,
> {
  readonly _tag: 'Component';
  readonly name: Name;
  readonly schema: Schema.Codec<Value, unknown>;
  readonly owner: O;
  readonly network: N;
  /** The component holding `value`, to spawn an entity with. */
  of(value: Value): Instance<Component<Name, Value, O, N>>;
  /** The value `entity` holds in `store`. */
  read(store: Store | undefined, entity: Entity): Option.Option<Value>;
  /** A copy of `store` that `set` may change in place, until it is sealed. */
  draft(store: Store | undefined): Store;
  /** Puts `value` in a draft this component made; a store that is not an unsealed draft is never changed. */
  set(store: Store | undefined, entity: Entity, value: Value): void;
  /** Takes `entity` out of a draft this component made, under the same terms as `set`. */
  remove(store: Store | undefined, entity: Entity): void;
  /** Ends a draft: from now on, nothing changes it. */
  seal(store: Store): void;
  /** Freezes every value in `store`, all the way down, so changing one in place throws. */
  freeze(store: Store): void;
  /** A store's values, encoded as JSON by this component's schema. */
  encode(store: Store | undefined): ReadonlyArray<readonly [Entity, unknown]>;
  /** A store of encoded values; `None` if any of them does not decode. */
  decode(entries: ReadonlyArray<readonly [Entity, unknown]>): Option.Option<Store>;
}

export type Any = Component<string, unknown, Owner>;

/** A component each client keeps and changes for itself, which only local systems write. */
export type Local = Component<string, unknown, 'simulation', 'local'>;

export type ValueOf<C> = C extends Component<string, infer Value, Owner> ? Value : never;

/** Freezes `value` and everything it holds; what is frozen already, and all it holds, is left as it is. */
const freezeDeep = (value: unknown): void => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return;
  }
  Object.freeze(value);
  for (const held of Object.values(value)) {
    freezeDeep(held);
  }
};

/**
 * Makes a component. Its values must never be `null` or `undefined`: holding nothing is the absence of the component, not a value of it.
 */
export const make = <
  const Name extends string,
  Value,
  const O extends Owner,
  const N extends NetworkRole,
>(
  name: Name,
  schema: Schema.Codec<Value, unknown>,
  options: { readonly owner: O; readonly network: N },
): Component<Name, Value, O, N> => {
  // What a value travels as: its schema's canonical JSON form, so an option or anything else that is not plain data still travels.
  const json = Schema.toCodecJson(schema);
  // Every store this component made, and the values in it. Nothing else can reach this map.
  const values = new WeakMap<Store, Map<Entity, Value>>();
  // The drafts still open to change; every other store is fixed for good.
  const open = new WeakSet<Store>();

  const storeOf = (map: Map<Entity, Value>): Store => {
    const store: Store = {
      has: (entity) => map.has(entity),
      entities: () => map.keys(),
      without: (entity) => {
        const remaining = new Map(map);
        remaining.delete(entity);
        return storeOf(remaining);
      },
    };
    values.set(store, map);
    return store;
  };

  const copyOf = (store: Store | undefined): Map<Entity, Value> =>
    new Map(store === undefined ? undefined : values.get(store));

  const component: Component<Name, Value, O, N> = {
    _tag: 'Component',
    name,
    schema,
    owner: options.owner,
    network: options.network,
    of: (value) => ({
      component,
      into: (store, entity) => storeOf(copyOf(store).set(entity, value)),
      writeWith: (write) => write(component, value),
      encoded: () => Schema.encodeSync(json)(value),
    }),
    read: (store, entity) =>
      Option.fromNullishOr(store === undefined ? undefined : values.get(store)?.get(entity)),
    draft: (store) => {
      const draft = storeOf(copyOf(store));
      open.add(draft);
      return draft;
    },
    set: (store, entity, value) => {
      if (store !== undefined && open.has(store)) {
        values.get(store)?.set(entity, value);
      }
    },
    remove: (store, entity) => {
      if (store !== undefined && open.has(store)) {
        values.get(store)?.delete(entity);
      }
    },
    seal: (store) => {
      open.delete(store);
    },
    freeze: (store) => {
      for (const value of values.get(store)?.values() ?? []) {
        freezeDeep(value);
      }
    },
    encode: (store) =>
      [...copyOf(store)].map(
        ([entity, value]) => [entity, Schema.encodeSync(json)(value)] as const,
      ),
    decode: (entries) =>
      Option.map(
        Option.all(
          entries.map(([entity, encoded]) =>
            Option.map(
              Schema.decodeUnknownOption(json)(encoded),
              (value) => [entity, value] as const,
            ),
          ),
        ),
        (decoded) => storeOf(new Map(decoded)),
      ),
  };
  return component;
};
