import type * as Action from '#src/Action.ts';
import type * as Component from '#src/Component.ts';
import type * as Event from '#src/Event.ts';
import type * as Rule from '#src/Rule.ts';
import type * as System from '#src/System.ts';

/**
 * A part of a game that owns some of its state: the components, actions, and events it brings, the systems and rules that change them, and the domains it requires. A game is the list of its domains.
 *
 * A domain writes only its own components, and those that a domain it requires shares. It reads and spawns its own and those of the domains it requires, and emits and handles its own events and theirs, so it changes another domain's state only through an event that domain declared, which that domain's rules decide on. Sharing is for state many domains change continuously, such as where a body is: a domain that moves a body every step cannot say so by an event. Each system still declares what it writes, so who changes a shared component can be read off the game. All of it is checked by type. Requiring is one way: two domains cannot require each other, since each must exist before the other can name it.
 */

/** What a domain is known by where it is required: its name. */
export interface Required<Name extends string = string> {
  readonly _tag: 'Domain';
  readonly name: Name;
}

export interface Domain<
  Name extends string = string,
  Components extends Component.Any = Component.Any,
  Actions extends Action.Any = Action.Any,
  Events extends Event.Any = Event.Any,
  Requires extends string = string,
  /** The tags of the actions and events its rules handle. */
  Handles extends string = string,
  /** The tags of the events its systems and rules emit. */
  Emits extends string = string,
  /** The components of its own that the domains requiring it may write too. */
  Shares extends Component.Any = Component.Any,
> extends Required<Name> {
  /** Carries what it handles and emits in its type; never set. */
  readonly '~parts'?: { readonly handles: Handles; readonly emits: Emits };
  readonly requires: ReadonlyArray<Required<Requires>>;
  readonly components: ReadonlyArray<Components>;
  readonly shares: ReadonlyArray<Shares>;
  readonly actions: ReadonlyArray<Actions>;
  readonly events: ReadonlyArray<Events>;
  readonly systems: ReadonlyArray<System.System>;
  readonly rules: ReadonlyArray<Rule.Rule>;
}

export type Any = Domain;

type Reads<Components extends ReadonlyArray<Component.Any>, Requires extends ReadonlyArray<Any>> =
  | Components[number]
  | Requires[number]['components'][number];

type Hears<
  Actions extends ReadonlyArray<Action.Any>,
  Events extends ReadonlyArray<Event.Any>,
  Requires extends ReadonlyArray<Any>,
> =
  | Actions[number]
  | Events[number]
  | Requires[number]['actions'][number]
  | Requires[number]['events'][number];

/** What a domain may write: its own components, and those the domains it requires share. */
type Writes<Components extends ReadonlyArray<Component.Any>, Requires extends ReadonlyArray<Any>> =
  | Components[number]
  | Requires[number]['shares'][number];

type Says<Events extends ReadonlyArray<Event.Any>, Requires extends ReadonlyArray<Any>> =
  | Events[number]
  | Requires[number]['events'][number];

export const make = <
  const Name extends string,
  const Requires extends ReadonlyArray<Any>,
  const Components extends ReadonlyArray<Component.Any>,
  const Actions extends ReadonlyArray<Action.Any>,
  const Events extends ReadonlyArray<Event.Any>,
  const Systems extends ReadonlyArray<
    System.System<
      Reads<Components, Requires>,
      Extract<Writes<Components, Requires>, System.SimulationComponent>,
      Says<Events, Requires>,
      Reads<Components, Requires>
    >
  >,
  const Rules extends ReadonlyArray<
    Rule.Rule<
      Hears<Actions, Events, Requires>,
      Extract<Writes<Components, Requires>, Rule.RulesComponent>,
      Says<Events, Requires>,
      Reads<Components, Requires>
    >
  >,
  const Shares extends ReadonlyArray<Components[number]> = [],
>(domain: {
  readonly name: Name;
  readonly requires: Requires;
  readonly components: Components;
  /** Its components the domains requiring it may write too; none if left out. */
  readonly shares?: Shares;
  readonly actions: Actions;
  readonly events: Events;
  readonly systems: Systems;
  readonly rules: Rules;
}): Domain<
  Name,
  Components[number],
  Actions[number],
  Events[number],
  Requires[number]['name'],
  Rules[number]['on']['tag'],
  Systems[number]['emits'][number]['tag'] | Rules[number]['emits'][number]['tag'],
  Shares[number]
> => ({ _tag: 'Domain', ...domain, shares: domain.shares ?? [] });
