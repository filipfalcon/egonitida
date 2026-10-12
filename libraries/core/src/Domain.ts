import type * as Action from '#src/Action.ts';
import type * as Command from '#src/Command.ts';
import type * as Component from '#src/Component.ts';
import type * as Event from '#src/Event.ts';
import type * as Rule from '#src/Rule.ts';
import type * as System from '#src/System.ts';

/**
 * A part of a game that owns some of its state: the components, actions, events, and commands it brings, the systems and rules that change them, and the domains it requires. A game is the list of its domains.
 *
 * A domain writes only its own components, and those that a domain it requires shares. It reads and spawns its own and those of the domains it requires, handles the actions of both and the results of both's commands, and emits and handles its own events and theirs, so it changes another domain's components only through an event that domain declared, which that domain's rules decide on. Sharing is for values many domains change continuously, such as where a body is: a domain that moves a body every step cannot say so by an event. Each system still declares what it writes, so who changes a shared component can be read off the game. All of it is checked by type. Requiring is one way: two domains cannot require each other, since each must exist before the other can name it.
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
  /** The tags of the actions and events its rules handle, the results of commands among them. */
  Handles extends string = string,
  /** The tags of the events its systems and rules emit. */
  Emits extends string = string,
  /** The components of its own that the domains requiring it may write too. */
  Shares extends Component.Any = Component.Any,
  /** The commands its rules may issue. */
  Commands extends Command.Any = Command.Any,
> extends Required<Name> {
  /** Carries what it handles and emits in its type; never set. */
  readonly '~parts'?: { readonly handles: Handles; readonly emits: Emits };
  readonly requires: ReadonlyArray<Required<Requires>>;
  readonly components: ReadonlyArray<Components>;
  readonly shares: ReadonlyArray<Shares>;
  readonly actions: ReadonlyArray<Actions>;
  readonly events: ReadonlyArray<Events>;
  readonly commands: ReadonlyArray<Commands>;
  readonly systems: ReadonlyArray<System.System>;
  readonly rules: ReadonlyArray<Rule.Rule>;
  /** The systems each client runs for itself after every step, over what only it keeps. */
  readonly localSystems: ReadonlyArray<System.System>;
}

export type Any = Domain;

type Reads<Components extends ReadonlyArray<Component.Any>, Requires extends ReadonlyArray<Any>> =
  | Components[number]
  | Requires[number]['components'][number];

/** What a domain's rules may handle: the actions of its own and of the domains it requires, the results of their commands, and their events. */
type Hears<
  Actions extends ReadonlyArray<Action.Any>,
  Events extends ReadonlyArray<Event.Any>,
  Commands extends ReadonlyArray<Command.Any>,
  Requires extends ReadonlyArray<Any>,
> =
  | Actions[number]
  | Events[number]
  | Commands[number]['results'][number]
  | Requires[number]['actions'][number]
  | Requires[number]['events'][number]
  | Requires[number]['commands'][number]['results'][number];

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
  const Commands extends ReadonlyArray<Command.Any> = [],
  const Systems extends ReadonlyArray<
    System.System<
      Reads<Components, Requires>,
      Exclude<Extract<Writes<Components, Requires>, System.SimulationComponent>, Component.Local>,
      Says<Events, Requires>,
      Reads<Components, Requires>
    >
  > = [],
  const Rules extends ReadonlyArray<
    Rule.Rule<
      Hears<Actions, Events, Commands, Requires>,
      Extract<Writes<Components, Requires>, Rule.RulesComponent>,
      Says<Events, Requires>,
      Reads<Components, Requires>,
      Commands[number]
    >
  > = [],
  const Shares extends ReadonlyArray<Components[number]> = [],
  const LocalSystems extends ReadonlyArray<
    System.System<
      Reads<Components, Requires>,
      Extract<Components[number], Component.Local>,
      never,
      Extract<Components[number], Component.Local>
    >
  > = [],
>(domain: {
  readonly name: Name;
  readonly requires: Requires;
  readonly components: Components;
  /** Its components the domains requiring it may write too; none if left out. */
  readonly shares?: Shares;
  readonly actions: Actions;
  readonly events: Events;
  /** The commands its rules may issue, whose results its rules or those of a domain requiring it must handle; none if left out. */
  readonly commands?: Commands;
  readonly systems: Systems;
  readonly rules: Rules;
  /** The systems each client runs for itself after every step: they read what the domain may, write and spawn only its local components, and emit nothing, since events are for the server's rules. None if left out. */
  readonly localSystems?: LocalSystems;
}): Domain<
  Name,
  Components[number],
  Actions[number],
  Events[number],
  Requires[number]['name'],
  Rules[number]['on']['tag'],
  Systems[number]['emits'][number]['tag'] | Rules[number]['emits'][number]['tag'],
  Shares[number],
  Commands[number]
> => ({
  _tag: 'Domain',
  ...domain,
  shares: domain.shares ?? [],
  commands: domain.commands ?? [],
  localSystems: domain.localSystems ?? [],
});
