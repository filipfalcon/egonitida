import { Option } from 'effect';
import type * as Component from '#src/Component.ts';
import type * as Event from '#src/Event.ts';
import type * as Input from '#src/Input.ts';
import * as Random from '#src/Random.ts';
import type * as Rule from '#src/Rule.ts';
import type * as System from '#src/System.ts';
import * as World from '#src/World.ts';

/**
 * A game: its fixed step rate, the systems that run every step in order, and the rules that handle what they emit.
 *
 * One step: the tick advances; the step's input is written to the entities it is aimed at; every system runs in order, each seeing what the ones before it wrote; then every event emitted is handled by the rules, one after another and in the order they happened, each rule seeing what the ones before it decided. Events the rules emit join the end of the line. The next step sees all of it.
 */

export interface Game {
  readonly stepRate: number;
  readonly systems: ReadonlyArray<System.System>;
  readonly rules: ReadonlyArray<Rule.Rule>;
}

export const make = (game: Game): Game => game;

export interface Step {
  readonly world: World.World;
  /** Every event of the step, in the order it happened. */
  readonly events: ReadonlyArray<Event.Tagged>;
}

export const step = (
  game: Game,
  world: World.World,
  inputs: ReadonlyArray<Input.Input> = [],
): Step => {
  const draft = World.draft(world);
  draft.tick += 1;
  // Input only reaches an entity spawned to accept it; anything else a client sends is ignored, not added.
  for (const input of inputs) {
    if (Option.isSome(World.get(draft, input.entity, input.component))) {
      World.write(draft, input.entity, input.component, input.value);
    }
  }
  const line: Array<Event.Tagged> = [];

  // Systems and rules share one context at run time; their types are what keep each to what it declared.
  const context: System.Context<Component.Any, Component.Any, Event.Any> &
    Rule.Context<Component.Any, Event.Any> = {
    time: { tick: draft.tick, stepSeconds: 1 / game.stepRate },
    random: () => {
      const [value, state] = Random.next(draft.random);
      draft.random = state;
      return value;
    },
    get: (entity, component) => World.get(draft, entity, component),
    query: (...components) => World.query(draft, ...components),
    set: (entity, component, value) => World.write(draft, entity, component, value),
    emit: (event: Event.Tagged) => {
      line.push(event);
    },
  };

  for (const system of game.systems) {
    system.run(context);
  }
  for (let index = 0; index < line.length; index += 1) {
    const event = line[index] as Event.Tagged;
    for (const rule of game.rules) {
      if (rule.tag === event._tag) {
        rule.run(context, event);
      }
    }
  }

  return { world: World.finish(draft), events: line };
};
