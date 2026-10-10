import type { Option } from 'effect';
import type * as Component from '#src/Component.ts';
import type * as Event from '#src/Event.ts';
import type { Time } from '#src/System.ts';
import type * as World from '#src/World.ts';

type Of<Value> = Component.Component<string, Value, Component.Owner>;

/**
 * What the game decides when something happens, such as what a bite does to health. A rule handles one event, may read anything, and writes only components the rules own, and only those it declared. It may emit further events, which are handled in the same step after it.
 */

export interface Context<Writes extends Component.Any, Emits extends Event.Any> {
  readonly time: Time;
  readonly random: () => number;
  readonly get: <Value>(entity: World.Entity, component: Of<Value>) => Option.Option<Value>;
  readonly query: World.Query<Component.Any>;
  readonly set: <Value>(entity: World.Entity, component: Of<Value> & Writes, value: Value) => void;
  readonly emit: (event: Event.ValueOf<Emits>) => void;
}

export type RulesComponent = Component.Component<string, unknown, 'rules'>;

export interface Rule {
  readonly tag: string;
  readonly writes: ReadonlyArray<RulesComponent>;
  readonly emits: ReadonlyArray<Event.Any>;
  /**
   * A method, so a rule written for its own event fits here: the engine calls a rule only with events of its tag, which the type of `event` cannot say on its own.
   */
  run(context: Context<Component.Any, Event.Any>, event: Event.Tagged): void;
}

export const on = <
  E extends Event.Any,
  const Writes extends ReadonlyArray<RulesComponent>,
  const Emits extends ReadonlyArray<Event.Any>,
>(
  event: E,
  spec: {
    readonly writes: Writes;
    readonly emits: Emits;
    readonly run: (
      context: Context<Writes[number], Emits[number]>,
      event: Event.ValueOf<E>,
    ) => void;
  },
): Rule => ({ tag: event.tag, ...spec });
