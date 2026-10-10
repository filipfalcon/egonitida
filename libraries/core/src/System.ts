import type { Option } from 'effect';
import type * as Component from '#src/Component.ts';
import type * as Event from '#src/Event.ts';
import type { Entity } from '#src/World.ts';

/**
 * Work the simulation does every step, such as moving things or noticing a bite. A system declares what it reads, what it writes, and what it emits, and the type checker holds it to that: it can only write components the simulation owns, and only those it declared.
 *
 * A system is plain synchronous code. It runs inside a step, many times a second, so it does no Effect work of its own.
 */

export interface Time {
  /** The step being taken, counted from one. */
  readonly tick: number;
  /** The fixed length of every step. */
  readonly stepSeconds: number;
}

export interface Context<
  Reads extends Component.Any,
  Writes extends Component.Any,
  Emits extends Event.Any,
> {
  readonly time: Time;
  /** A number in [0, 1) from the world's own generator. Systems take randomness from nowhere else. */
  readonly random: () => number;
  readonly get: <C extends Reads | Writes>(
    entity: Entity,
    component: C,
  ) => Option.Option<Component.ValueOf<C>>;
  readonly query: <const Cs extends ReadonlyArray<Reads | Writes>>(
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
export type SimulationComponent = Component.Component<string, any, 'simulation'>;

export interface System {
  readonly name: string;
  readonly reads: ReadonlyArray<Component.Any>;
  readonly writes: ReadonlyArray<SimulationComponent>;
  readonly emits: ReadonlyArray<Event.Any>;
  // oxlint-disable-next-line typescript/no-explicit-any
  readonly run: (context: Context<any, any, any>) => void;
}

export const make = <
  const Reads extends ReadonlyArray<Component.Any>,
  const Writes extends ReadonlyArray<SimulationComponent>,
  const Emits extends ReadonlyArray<Event.Any>,
>(spec: {
  readonly name: string;
  readonly reads: Reads;
  readonly writes: Writes;
  readonly emits: Emits;
  readonly run: (context: Context<Reads[number], Writes[number], Emits[number]>) => void;
}): System => spec as System;
