import type { Schema } from 'effect';

/**
 * A kind of data an entity can hold, described by a Schema. A component is the unit of ownership: all of it is changed by one owner and travels the network one way. When part of something needs another owner, it is another component.
 */

/** Who may change a component: the rules, through events, or the systems, every step. */
export type Owner = 'rules' | 'simulation';

/**
 * How a component travels: decided by the server and sent to every client, guessed by a client and confirmed by the server, or kept on the client alone.
 */
export type NetworkRole = 'server' | 'predicted' | 'local';

export interface Instance {
  readonly component: Any;
  readonly value: unknown;
}

export interface Component<Name extends string, Value, O extends Owner> {
  readonly _tag: 'Component';
  readonly name: Name;
  readonly schema: Schema.Top;
  readonly owner: O;
  readonly network: NetworkRole;
  /** The component holding `value`, to spawn an entity with. */
  readonly of: (value: Value) => Instance;
  /** Carries the value's type; never set. */
  readonly '~value'?: Value;
}

// `any` here is deliberate: a component of any value must fit where any component is accepted.
// oxlint-disable-next-line typescript/no-explicit-any
export type Any = Component<string, any, Owner>;

export type ValueOf<C> = C extends Component<string, infer Value, Owner> ? Value : never;

export type ValuesOf<Cs extends ReadonlyArray<Any>> = { readonly [K in keyof Cs]: ValueOf<Cs[K]> };

export const make = <const Name extends string, S extends Schema.Top, const O extends Owner>(
  name: Name,
  schema: S,
  options: { readonly owner: O; readonly network: NetworkRole },
): Component<Name, S['Type'], O> => {
  const component: Component<Name, S['Type'], O> = {
    _tag: 'Component',
    name,
    schema,
    owner: options.owner,
    network: options.network,
    of: (value) => ({ component, value }),
  };
  return component;
};
