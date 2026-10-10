import type { Option } from 'effect';
import type * as Component from '#src/Component.ts';
import type * as Event from '#src/Event.ts';
import type { Despawning, Spawning, Time } from '#src/System.ts';
import type * as World from '#src/World.ts';

type Of<Value> = Component.Component<string, Value, Component.Owner>;

/**
 * What the game decides when something happens, such as what a bite does to health. A rule handles one event, may read anything, and writes only components the rules own, and only those it declared. It may emit further events, which are handled in the same step after it.
 */

export interface Context<
  Writes extends Component.Any,
  Emits extends Event.Any,
  Spawns extends Component.Any = never,
  Despawns extends boolean = false,
>
  extends Spawning<Spawns>, Despawning<Despawns> {
  readonly time: Time;
  readonly random: () => number;
  readonly get: <Value>(entity: World.Entity, component: Of<Value>) => Option.Option<Value>;
  readonly query: World.Query<Component.Any>;
  readonly set: <Value>(entity: World.Entity, component: Of<Value> & Writes, value: Value) => void;
  readonly emit: (event: Event.ValueOf<Emits>) => void;
}

export type RulesComponent = Component.Component<string, unknown, 'rules'>;

/** A rule, with what it declared kept in its type, so a game can check it holds all of them. */
export interface Rule<
  On extends Event.Any = Event.Any,
  Writes extends RulesComponent = RulesComponent,
  Emits extends Event.Any = Event.Any,
  Spawns extends Component.Any = Component.Any,
> {
  /** The event or action it handles. */
  readonly on: On;
  readonly writes: ReadonlyArray<Writes>;
  readonly emits: ReadonlyArray<Emits>;
  readonly spawns: ReadonlyArray<Spawns>;
  readonly despawns: boolean;
  /**
   * A method, so a rule written for its own event fits here: the engine calls a rule only with events of its tag, which the type of `event` cannot say on its own.
   */
  run(context: Context<Component.Any, Event.Any, Component.Any, true>, event: Event.Tagged): void;
}

export const on = <
  E extends Event.Any,
  const Writes extends ReadonlyArray<RulesComponent>,
  const Emits extends ReadonlyArray<Event.Any>,
  const Spawns extends ReadonlyArray<Component.Any> = [],
  const Despawns extends boolean = false,
>(
  event: E,
  spec: {
    readonly writes: Writes;
    readonly emits: Emits;
    /** The components it may spawn entities with; none if left out. */
    readonly spawns?: Spawns;
    /** Whether it may despawn entities; not if left out. */
    readonly despawns?: Despawns;
    readonly run: (
      context: Context<Writes[number], Emits[number], Spawns[number], Despawns>,
      event: Event.ValueOf<E>,
    ) => void;
  },
): Rule<E, Writes[number], Emits[number], Spawns[number]> => ({
  on: event,
  ...spec,
  spawns: spec.spawns ?? [],
  despawns: spec.despawns ?? false,
});
