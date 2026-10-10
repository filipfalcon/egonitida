import type { Option } from 'effect';
import type * as Component from '#src/Component.ts';
import type * as Event from '#src/Event.ts';
import type { Time } from '#src/System.ts';
import type { Entity } from '#src/World.ts';

/**
 * What the game decides when something happens, such as what a bite does to health. A rule handles one event, may read anything, and writes only components the rules own, and only those it declared. It may emit further events, which are handled in the same step after it.
 */

export interface Context<Writes extends Component.Any, Emits extends Event.Any> {
  readonly time: Time;
  readonly random: () => number;
  readonly get: <C extends Component.Any>(
    entity: Entity,
    component: C,
  ) => Option.Option<Component.ValueOf<C>>;
  readonly query: <const Cs extends ReadonlyArray<Component.Any>>(
    ...components: Cs
  ) => ReadonlyArray<readonly [Entity, ...Component.ValuesOf<Cs>]>;
  readonly set: <C extends Writes>(
    entity: Entity,
    component: C,
    value: Component.ValueOf<C>,
  ) => void;
  readonly emit: (event: Event.ValueOf<Emits>) => void;
}

// oxlint-disable-next-line typescript/no-explicit-any
export type RulesComponent = Component.Component<string, any, 'rules'>;

export interface Rule {
  readonly tag: string;
  readonly writes: ReadonlyArray<RulesComponent>;
  readonly emits: ReadonlyArray<Event.Any>;
  // oxlint-disable-next-line typescript/no-explicit-any
  readonly run: (context: Context<any, any>, event: any) => void;
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
): Rule => ({ tag: event.tag, ...spec }) as Rule;
