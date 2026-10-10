import { Option } from 'effect';
import type * as Action from '#src/Action.ts';
import type * as Component from '#src/Component.ts';
import type * as Event from '#src/Event.ts';
import type * as Input from '#src/Input.ts';
import * as Random from '#src/Random.ts';
import type * as Rule from '#src/Rule.ts';
import type * as System from '#src/System.ts';
import * as World from '#src/World.ts';

/**
 * A game: its fixed step rate, everything its state is made of (its components, the actions its players take, and the events its steps emit), the systems that run every step in order, and the rules that handle actions and events. A host and its clients take what to send and decode from it.
 *
 * One step: the tick advances; the step's input is written to the entities it is aimed at; the players' actions are handled by the rules, in the order they came; every system runs in order, each seeing what the ones before it wrote; then every event emitted is handled by the rules, one after another and in the order they happened, each rule seeing what the ones before it decided. Events the rules emit join the end of the line. The next step sees all of it.
 */

export interface Game {
  readonly stepRate: number;
  readonly components: ReadonlyArray<Component.Any>;
  readonly actions: ReadonlyArray<Action.Any>;
  readonly events: ReadonlyArray<Event.Any>;
  readonly systems: ReadonlyArray<System.System>;
  readonly rules: ReadonlyArray<Rule.Rule>;
}

/**
 * A game made of what it declares: a system or a rule that reads, writes, emits, spawns, or handles anything the game does not declare does not compile. Rules may read any component, so what they read is not checked; one the game does not hold is simply never there.
 */
export const make = <
  const Components extends ReadonlyArray<Component.Any>,
  const Actions extends ReadonlyArray<Action.Any>,
  const Events extends ReadonlyArray<Event.Any>,
>(game: {
  readonly stepRate: number;
  readonly components: Components;
  readonly actions: Actions;
  readonly events: Events;
  readonly systems: ReadonlyArray<
    System.System<
      Components[number],
      Extract<Components[number], System.SimulationComponent>,
      Events[number],
      Components[number]
    >
  >;
  readonly rules: ReadonlyArray<
    Rule.Rule<
      Actions[number] | Events[number],
      Extract<Components[number], Rule.RulesComponent>,
      Events[number],
      Components[number]
    >
  >;
}): Game => game;

export interface Step {
  readonly world: World.World;
  /** Every event of the step, in the order it happened. */
  readonly events: ReadonlyArray<Event.Tagged>;
}

export interface StepOptions {
  /** Freezes every value of the world the step leaves, so a system or rule that changes one in place throws at once. For development: it walks the whole world. */
  readonly freeze?: boolean;
}

export const step = (
  game: Game,
  world: World.World,
  inputs: ReadonlyArray<Input.Input> = [],
  actions: ReadonlyArray<Event.Tagged> = [],
  options: StepOptions = {},
): Step => {
  // The world a step is given is frozen too, so even what it was spawned with fails at once when changed in place.
  const freezing = options.freeze === true ? game.components : [];
  for (const component of freezing) {
    const store = world.stores.get(component.name);
    if (store !== undefined) {
      component.freeze(store);
    }
  }
  const draft = World.draft(world);
  draft.tick += 1;
  // Input only reaches an entity spawned to accept it; anything else a client sends is ignored, not added.
  for (const input of inputs) {
    if (Option.isSome(World.get(draft, input.entity, input.component))) {
      input.writeInto(draft);
    }
  }
  // Everything that happens in the step, in order: the actions first, then what systems and rules emit.
  const line: Array<Event.Tagged> = [...actions];
  const handled = { count: 0 };
  /** Hands every event not yet handled to the rules that handle it, including events those rules emit meanwhile. */
  const settle = () => {
    for (const event of line.slice(handled.count)) {
      handled.count += 1;
      for (const rule of game.rules) {
        if (rule.on.tag === event._tag) {
          rule.run(context, event);
        }
      }
    }
    if (handled.count < line.length) {
      settle();
    }
  };

  // Systems and rules share one context at run time; their types are what keep each to what it declared.
  const context: System.Context<Component.Any, Component.Any, Event.Any, Component.Any, true> &
    Rule.Context<Component.Any, Event.Any, Component.Any, true> = {
    time: { tick: draft.tick, stepSeconds: 1 / game.stepRate },
    random: () => {
      const [value, state] = Random.next(draft.random);
      draft.random = state;
      return value;
    },
    get: <Value>(
      entity: World.Entity,
      component: Component.Component<string, Value, Component.Owner>,
    ) => World.get(draft, entity, component),
    query: World.queryIn(draft),
    set: (entity, component, value) => World.write(draft, entity, component, value),
    emit: (event: Event.Tagged) => {
      line.push(event);
    },
    spawn: (instances) => World.spawnInto(draft, instances),
    despawn: (entity) => World.despawnFrom(draft, entity),
  };

  // The players' actions are decided before anything moves, so the systems see what the rules made of them.
  settle();
  for (const system of game.systems) {
    system.run(context);
  }
  settle();

  return {
    world: World.finish(draft, freezing),
    events: line,
  };
};

/** The schema of a whole world of `game`: what saves, recordings, and the debugger carry it in. */
export const schema = (game: Game) => World.schema(game.components);

// CHANGES

/** A part of a game that changes its state: a system, by its name, or a rule, by the event or action it handles. */
export type Part =
  | { readonly _tag: 'System'; readonly name: string }
  | { readonly _tag: 'Rule'; readonly on: string };

export interface ComponentChanges {
  /** The systems that read it. Rules may read anything, so they are never listed. */
  readonly readBy: ReadonlyArray<Part>;
  readonly writtenBy: ReadonlyArray<Part>;
  readonly spawnedBy: ReadonlyArray<Part>;
}

export interface EventChanges {
  readonly emittedBy: ReadonlyArray<Part>;
  readonly handledBy: ReadonlyArray<Part>;
}

/** How a game's state changes, read off what its systems and rules declare: by component, by event or action, and what may despawn. */
export interface Changes {
  readonly components: ReadonlyMap<string, ComponentChanges>;
  readonly events: ReadonlyMap<string, EventChanges>;
  readonly despawnedBy: ReadonlyArray<Part>;
}

/**
 * The map of how `game` changes its state. A game of systems has no single `update` to read; its declarations are what is read instead, by people, the debugger, and agents alike. Parts are listed in the order the game runs them.
 */
export const changes = (game: Game): Changes => {
  const parts = [
    ...game.systems.map((system) => ({
      part: { _tag: 'System', name: system.name } satisfies Part,
      reads: system.reads,
      writes: system.writes,
      spawns: system.spawns,
      emits: system.emits,
      handles: [],
      despawns: system.despawns,
    })),
    ...game.rules.map((rule) => ({
      part: { _tag: 'Rule', on: rule.on.tag } satisfies Part,
      reads: [],
      writes: rule.writes,
      spawns: rule.spawns,
      emits: rule.emits,
      handles: [rule.on],
      despawns: rule.despawns,
    })),
  ];
  const by = (has: (part: (typeof parts)[number]) => boolean) =>
    parts.filter(has).map(({ part }) => part);
  return {
    components: new Map(
      game.components.map((component) => [
        component.name,
        {
          readBy: by(({ reads }) => reads.some(({ name }) => name === component.name)),
          writtenBy: by(({ writes }) => writes.some(({ name }) => name === component.name)),
          spawnedBy: by(({ spawns }) => spawns.some(({ name }) => name === component.name)),
        },
      ]),
    ),
    events: new Map(
      [...game.actions, ...game.events].map((event) => [
        event.tag,
        {
          emittedBy: by(({ emits }) => emits.some(({ tag }) => tag === event.tag)),
          handledBy: by(({ handles }) => handles.some(({ tag }) => tag === event.tag)),
        },
      ]),
    ),
    despawnedBy: by(({ despawns }) => despawns),
  };
};
