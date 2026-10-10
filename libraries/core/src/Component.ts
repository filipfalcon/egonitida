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
 * How a component travels: decided by the server and sent to every client, guessed by a client and confirmed by the server, or kept on the client alone.
 */
export type NetworkRole = 'server' | 'predicted' | 'local';

/** One component's values by entity. Only the component that made a store can read the values in it. */
export interface Store {
  readonly has: (entity: Entity) => boolean;
  readonly entities: () => IterableIterator<Entity>;
  /** The store without `entity`. */
  readonly without: (entity: Entity) => Store;
}

/** A copy of a store being changed in place, for the length of one step. */
export interface Draft<Value> {
  readonly store: Store;
  set(entity: Entity, value: Value): void;
}

/** A component holding a value, ready to be given to an entity. */
export interface Instance {
  readonly component: Any;
  /** `store` with `entity` holding this value. */
  readonly into: (store: Store | undefined, entity: Entity) => Store;
  /** This value, encoded by its component's schema. */
  readonly encoded: () => unknown;
}

/**
 * Methods rather than function properties wherever a parameter is the component's value: TypeScript checks a method's parameters both ways, so a component of a particular value still fits where any component is accepted.
 */
export interface Component<Name extends string, Value, O extends Owner> {
  readonly _tag: 'Component';
  readonly name: Name;
  readonly schema: Schema.Codec<Value, unknown>;
  readonly owner: O;
  readonly network: NetworkRole;
  /** The component holding `value`, to spawn an entity with. */
  of(value: Value): Instance;
  /** The value `entity` holds in `store`. */
  read(store: Store | undefined, entity: Entity): Option.Option<Value>;
  /** A copy of `store` to change in place; only values of this component go in. */
  draft(store: Store | undefined): Draft<Value>;
  /** A store's values, encoded by this component's schema. */
  encode(store: Store | undefined): ReadonlyArray<readonly [Entity, unknown]>;
  /** A store of encoded values; `None` if any of them does not decode. */
  decode(entries: ReadonlyArray<readonly [Entity, unknown]>): Option.Option<Store>;
}

export type Any = Component<string, unknown, Owner>;

export type ValueOf<C> = C extends Component<string, infer Value, Owner> ? Value : never;

/**
 * Makes a component. Its values must never be `null` or `undefined`: holding nothing is the absence of the component, not a value of it.
 */
export const make = <const Name extends string, Value, const O extends Owner>(
  name: Name,
  schema: Schema.Codec<Value, unknown>,
  options: { readonly owner: O; readonly network: NetworkRole },
): Component<Name, Value, O> => {
  // Every store this component made, and the values in it. Nothing else can reach this map.
  const values = new WeakMap<Store, Map<Entity, Value>>();

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

  const component: Component<Name, Value, O> = {
    _tag: 'Component',
    name,
    schema,
    owner: options.owner,
    network: options.network,
    of: (value) => ({
      component,
      into: (store, entity) => storeOf(copyOf(store).set(entity, value)),
      encoded: () => Schema.encodeSync(schema)(value),
    }),
    read: (store, entity) =>
      Option.fromNullishOr(store === undefined ? undefined : values.get(store)?.get(entity)),
    draft: (store) => {
      const map = copyOf(store);
      return {
        store: storeOf(map),
        set: (entity, value) => {
          map.set(entity, value);
        },
      };
    },
    encode: (store) =>
      [...copyOf(store)].map(
        ([entity, value]) => [entity, Schema.encodeSync(schema)(value)] as const,
      ),
    decode: (entries) =>
      Option.map(
        Option.all(
          entries.map(([entity, encoded]) =>
            Option.map(
              Schema.decodeUnknownOption(schema)(encoded),
              (value) => [entity, value] as const,
            ),
          ),
        ),
        (decoded) => storeOf(new Map(decoded)),
      ),
  };
  return component;
};
