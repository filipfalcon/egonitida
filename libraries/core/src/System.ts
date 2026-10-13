import type { Option } from 'effect';
import type * as Component from '#src/Component.ts';
import type * as Event from '#src/Event.ts';
import type * as Rule from '#src/Rule.ts';
import type * as State from '#src/State.ts';

type Of<Value> = Component.Component<string, Value, Component.Owner>;

/**
 * Work the simulation does every step, such as moving things or noticing a bite. A system declares what it reads, what it writes, and what it emits, and the type checker holds it to that: it can only write components the simulation owns, and only those it declared.
 *
 * A system is plain synchronous code. It runs inside a step, many times a second, so it does no Effect work of its own.
 */

export interface Time {
  /** The tick the step reaches, counted from one. */
  readonly tick: number;
  /** The length of one step in seconds: the inverse of the game's step rate. */
  readonly secondsPerStep: number;
}

/** Spawning: an entity made with components declared for it, and its id at once. Being born is no change to anyone's components, so who owns a component does not limit it; the declaration does. */
export interface Spawning<Spawns extends Component.Any> {
  readonly spawn: (instances: ReadonlyArray<Component.Instance<Spawns>>) => State.Entity;
}

/** What `despawn` takes, by whether despawning is declared: nothing at all where it is not, so a call there does not compile. Looked up rather than decided by a conditional type, so a context that may despawn still fits where one that may not is expected. */
interface Despawnable {
  readonly true: State.Entity;
  readonly false: never;
}

/** Despawning takes an entity out of every component at once, whoever owns them, so it is declared on its own. */
export interface Despawning<Despawns extends boolean> {
  readonly despawn: (entity: Despawnable[`${Despawns}`]) => void;
}

export interface Context<
  Reads extends Component.Any,
  Writes extends Component.Any,
  Emits extends Event.Any,
  Spawns extends Component.Any = never,
  Despawns extends boolean = false,
>
  extends Spawning<Spawns>, Despawning<Despawns> {
  readonly time: Time;
  /** A number in [0, 1) from the game's own generator, whose counter the state keeps. Systems take randomness from nowhere else. */
  readonly random: () => number;
  /** Only components the system declared; a component's name is what identifies it. */
  readonly get: <Value>(
    entity: State.Entity,
    component: Component.Component<(Reads | Writes)['name'], Value, Component.Owner>,
  ) => Option.Option<Value>;
  readonly query: State.Query<Reads | Writes>;
  readonly set: <Value>(entity: State.Entity, component: Of<Value> & Writes, value: Value) => void;
  readonly emit: (event: Rule.ValueOf<Emits>) => void;
}

export type SimulationComponent = Component.Component<string, unknown, 'simulation'>;

/** A system, with what it declared kept in its type, so a game can check it holds all of them. */
export interface System<
  Reads extends Component.Any = Component.Any,
  Writes extends SimulationComponent = SimulationComponent,
  Emits extends Event.Any = Event.Any,
  Spawns extends Component.Any = Component.Any,
> {
  readonly name: string;
  readonly reads: ReadonlyArray<Reads>;
  readonly writes: ReadonlyArray<Writes>;
  readonly emits: ReadonlyArray<Emits>;
  readonly spawns: ReadonlyArray<Spawns>;
  readonly despawns: boolean;
  // A context that allows everything fits wherever a system declared less, so any system's `run` fits here.
  readonly run: (
    context: Context<Component.Any, Component.Any, Event.Any, Component.Any, true>,
  ) => void;
}

export const make = <
  const Reads extends ReadonlyArray<Component.Any>,
  const Writes extends ReadonlyArray<SimulationComponent>,
  const Emits extends ReadonlyArray<Event.Any>,
  const Spawns extends ReadonlyArray<Component.Any> = [],
  const Despawns extends boolean = false,
>(spec: {
  readonly name: string;
  readonly reads: Reads;
  readonly writes: Writes;
  readonly emits: Emits;
  /** The components it may spawn entities with; none if left out. */
  readonly spawns?: Spawns;
  /** Whether it may despawn entities; not if left out. */
  readonly despawns?: Despawns;
  readonly run: (
    context: Context<Reads[number], Writes[number], Emits[number], Spawns[number], Despawns>,
  ) => void;
}): System<Reads[number], Writes[number], Emits[number], Spawns[number]> => ({
  ...spec,
  spawns: spec.spawns ?? [],
  despawns: spec.despawns ?? false,
});
