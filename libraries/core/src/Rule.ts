import { Option, type Schema } from 'effect';
import type * as Command from '#src/Command.ts';
import type * as Component from '#src/Component.ts';
import type * as Event from '#src/Event.ts';
import type { Despawning, Spawning, Time } from '#src/System.ts';
import type * as State from '#src/State.ts';

type Of<Value> = Component.Component<string, Value, Component.Owner>;

/**
 * What the game decides when something happens, such as what a bite does to health. A rule handles one action or event, may read anything, and writes only components the rules own, and only those it declared. It may emit further events, which are handled in the same step after it, and issue the commands it declared, which are done outside the game once the step is over (see `Command.ts`).
 */

/** What a rule handles: an action, a player's (`Action.make`) or a command's result (`Command.result`), or an event (`Event.make`), declared by its tag and the schema its values are recorded with. Which of the three it is, its declaration says, and never changes. */
export interface Cause<Tag extends string = string, Value = Event.Tagged> {
  readonly _tag: 'Action' | 'Result' | 'Event';
  readonly tag: Tag;
  /** Encodes and decodes it with no services, so it can be recorded, replayed, and sent. */
  readonly schema: Schema.Codec<Value, unknown>;
  /** Carries the value's type; never set. */
  readonly '~value'?: Value;
  /** Whether `value` is one of this kind, checked by its schema. */
  is(value: Event.Tagged): value is Event.Tagged & Value;
}

/** The value of `C`, an action or event, as a rule handles it. */
export type ValueOf<C> = C extends Cause<string, infer Value> ? Value : never;

export interface Context<
  Writes extends Component.Any,
  Emits extends Event.Any,
  Spawns extends Component.Any = never,
  Despawns extends boolean = false,
  Commands extends Command.Any = never,
>
  extends Spawning<Spawns>, Despawning<Despawns> {
  readonly time: Time;
  readonly random: () => number;
  readonly get: <Value>(entity: State.Entity, component: Of<Value>) => Option.Option<Value>;
  readonly query: State.Query<Component.Any>;
  readonly set: <Value>(entity: State.Entity, component: Of<Value> & Writes, value: Value) => void;
  readonly emit: (event: ValueOf<Emits>) => void;
  /** Issues a command it declared, to be done once the step is over. A method, so a step can hand a rule written for any commands one that knows its game's. */
  command(issued: Command.IssuedOf<Commands>): void;
}

export type RulesComponent = Component.Component<string, unknown, 'rules'>;

/** A rule, with what it declared kept in its type, so a game can check it holds all of them. */
export interface Rule<
  On extends Cause = Cause,
  Writes extends RulesComponent = RulesComponent,
  Emits extends Event.Any = Event.Any,
  Spawns extends Component.Any = Component.Any,
  Commands extends Command.Any = Command.Any,
> {
  /** The action or event it handles. */
  readonly on: On;
  /** What it is called, where more than one rule handles its event and the map of a game's changes should tell them apart. */
  readonly name: Option.Option<string>;
  readonly writes: ReadonlyArray<Writes>;
  readonly emits: ReadonlyArray<Emits>;
  readonly spawns: ReadonlyArray<Spawns>;
  readonly despawns: boolean;
  readonly commands: ReadonlyArray<Commands>;
  /**
   * A method, so a rule written for its own action or event fits here: the engine calls a rule only with values of its tag, which the type of `cause` cannot say on its own.
   */
  run(
    context: Context<Component.Any, Event.Any, Component.Any, true, Command.Any>,
    cause: Event.Tagged,
  ): void;
}

export const on = <
  E extends Cause,
  const Writes extends ReadonlyArray<RulesComponent>,
  const Emits extends ReadonlyArray<Event.Any>,
  const Spawns extends ReadonlyArray<Component.Any> = [],
  const Despawns extends boolean = false,
  const Commands extends ReadonlyArray<Command.Any> = [],
>(
  event: E,
  spec: {
    /** What it is called; none if left out. */
    readonly name?: string;
    readonly writes: Writes;
    readonly emits: Emits;
    /** The components it may spawn entities with; none if left out. */
    readonly spawns?: Spawns;
    /** Whether it may despawn entities; not if left out. */
    readonly despawns?: Despawns;
    /** The commands it may issue; none if left out. */
    readonly commands?: Commands;
    readonly run: (
      context: Context<Writes[number], Emits[number], Spawns[number], Despawns, Commands[number]>,
      cause: ValueOf<E>,
    ) => void;
  },
): Rule<E, Writes[number], Emits[number], Spawns[number], Commands[number]> => ({
  on: event,
  ...spec,
  name: Option.fromNullishOr(spec.name),
  spawns: spec.spawns ?? [],
  despawns: spec.despawns ?? false,
  commands: spec.commands ?? [],
});
