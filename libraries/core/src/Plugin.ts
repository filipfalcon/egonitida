import type * as Action from '#src/Action.ts';
import type * as Component from '#src/Component.ts';
import type * as Event from '#src/Event.ts';
import type * as Rule from '#src/Rule.ts';
import type * as System from '#src/System.ts';

/**
 * A part of a game that owns some of its state: the components, actions, and events it brings, the systems and rules that change them, and the plugins it requires. A game is the list of its plugins.
 *
 * A plugin writes only its own components. It reads and spawns its own and those of the plugins it requires, and emits and handles its own events and theirs, so it changes another plugin's state only through an event that plugin declared, which that plugin's rules decide on. All of it is checked by type. Requiring is one way: two plugins cannot require each other, since each must exist before the other can name it.
 */

/** What a plugin is known by where it is required: its name. */
export interface Required<Name extends string = string> {
  readonly _tag: 'Plugin';
  readonly name: Name;
}

export interface Plugin<
  Name extends string = string,
  Components extends Component.Any = Component.Any,
  Actions extends Action.Any = Action.Any,
  Events extends Event.Any = Event.Any,
  Requires extends string = string,
> extends Required<Name> {
  readonly requires: ReadonlyArray<Required<Requires>>;
  readonly components: ReadonlyArray<Components>;
  readonly actions: ReadonlyArray<Actions>;
  readonly events: ReadonlyArray<Events>;
  readonly systems: ReadonlyArray<System.System>;
  readonly rules: ReadonlyArray<Rule.Rule>;
}

export type Any = Plugin;

export const make = <
  const Name extends string,
  const Requires extends ReadonlyArray<Any>,
  const Components extends ReadonlyArray<Component.Any>,
  const Actions extends ReadonlyArray<Action.Any>,
  const Events extends ReadonlyArray<Event.Any>,
>(plugin: {
  readonly name: Name;
  readonly requires: Requires;
  readonly components: Components;
  readonly actions: Actions;
  readonly events: Events;
  readonly systems: ReadonlyArray<
    System.System<
      Components[number] | Requires[number]['components'][number],
      Extract<Components[number], System.SimulationComponent>,
      Events[number] | Requires[number]['events'][number],
      Components[number] | Requires[number]['components'][number]
    >
  >;
  readonly rules: ReadonlyArray<
    Rule.Rule<
      | Actions[number]
      | Events[number]
      | Requires[number]['actions'][number]
      | Requires[number]['events'][number],
      Extract<Components[number], Rule.RulesComponent>,
      Events[number] | Requires[number]['events'][number],
      Components[number] | Requires[number]['components'][number]
    >
  >;
}): Plugin<
  Name,
  Components[number],
  Actions[number],
  Events[number],
  Requires[number]['name']
> => ({ _tag: 'Plugin', ...plugin });
