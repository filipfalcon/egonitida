import { Option, Schema } from 'effect';
import type * as Action from '#src/Action.ts';
import type * as Component from '#src/Component.ts';
import type * as Event from '#src/Event.ts';
import * as Game from '#src/Game.ts';
import * as Input from '#src/Input.ts';
import * as World from '#src/World.ts';

/**
 * A test told as a story of a game: a world, the entities in it by name, what players send and do, the steps taken, and what is expected after them. A story steps the game itself, with no host, no clock, and no runtime, so it is as deterministic and as fast as a step.
 *
 * An expectation that does not hold throws, so a story fails the test it is told in. What an expectation asserts about a value is the test's own, written with its own `expect`.
 */

type Of<Value> = Component.Component<string, Value, Component.Owner>;

export interface Simulation {
  readonly game: Game.Game;
  readonly world: World.World;
  /** The entities the story named, by name. */
  readonly names: ReadonlyMap<string, World.Entity>;
  /** The input waiting for the next step. */
  readonly inputs: ReadonlyArray<Input.Input>;
  /** The actions taken and events made to happen, waiting for the next step in the order they came. */
  readonly actions: ReadonlyArray<Event.Tagged>;
  /** Every event of the steps last taken, in the order it happened. */
  readonly events: ReadonlyArray<Event.Tagged>;
}

/** One part of a story: what it does to the simulation told so far. */
export type Step = (simulation: Simulation) => Simulation;

const entityOf = (simulation: Simulation, name: string): World.Entity => {
  const entity = simulation.names.get(name);
  if (entity === undefined) {
    throw new Error(`no entity is named ${name}`);
  }
  return entity;
};

/** Tells `steps` of `game` in order, from an empty world seeded with 0 unless one is given; returns where the story ends. */
export const story = (game: Game.Game, ...steps: ReadonlyArray<Step>): Simulation =>
  steps.reduce<Simulation>((simulation, step) => step(simulation), {
    game,
    world: World.empty({ seed: 0 }),
    names: new Map(),
    inputs: [],
    actions: [],
    events: [],
  });

// SETTING THE SCENE

/** Starts from `world`, built however a test likes, with its entities named by `names`; the names given so far are forgotten. */
export const given =
  (world: World.World, names: Readonly<Record<string, World.Entity>> = {}): Step =>
  (simulation) => ({ ...simulation, world, names: new Map(Object.entries(names)) });

/** Spawns an entity holding `instances`, by the name `name`. */
export const spawn =
  (name: string, instances: ReadonlyArray<Component.Instance>): Step =>
  (simulation) => {
    const [world, entity] = World.spawn(simulation.world, instances);
    return { ...simulation, world, names: new Map([...simulation.names, [name, entity]]) };
  };

// WHAT PLAYERS SEND

/** Sends input for the entity named `name`, as its client would; it reaches the next step, and stays in the world after it. */
export const input =
  <Value>(
    name: string,
    component: Component.Component<string, Value, 'input'>,
    value: Value,
  ): Step =>
  (simulation) => ({
    ...simulation,
    inputs: [...simulation.inputs, Input.of(entityOf(simulation, name), component, value)],
  });

/** Takes `action` as from the player named `name`, sent and accepted as a host would; the rules handle it at the next step. */
export const act =
  <Sent>(name: string, action: Action.Action<string, Sent, Event.Tagged>, value: Sent): Step =>
  (simulation) =>
    Option.match(action.accept(action.encode(value), entityOf(simulation, name)), {
      onNone: () => {
        throw new Error(`${action.tag} does not accept what it encodes`);
      },
      onSome: (accepted) => ({ ...simulation, actions: [...simulation.actions, accepted] }),
    });

/** Has `event` happen at the next step with `fields`, as if something had emitted it, so the rules that handle it can be told on their own. */
export const happen =
  <Value extends Event.Tagged>(
    event: Event.Event<string, Value>,
    fields: Omit<Value, '_tag'>,
  ): Step =>
  (simulation) => {
    const value = { ...fields, _tag: event.tag };
    if (!event.is(value)) {
      throw new Error(`what is to happen is not a ${event.tag}`);
    }
    return { ...simulation, actions: [...simulation.actions, value] };
  };

// TIME

// A story always freezes the worlds it steps through: a test is where changing one in place should fail.
const frozen: Game.StepOptions = { freeze: true };

/** Takes `count` steps: the waiting input and actions go into the first. */
export const steps =
  (count: number): Step =>
  (simulation) => {
    const events: Array<Event.Tagged> = [];
    const world = Array.from({ length: count }).reduce<World.World>((current, _, index) => {
      const step =
        index === 0
          ? Game.step(simulation.game, current, simulation.inputs, simulation.actions, frozen)
          : Game.step(simulation.game, current, [], [], frozen);
      events.push(...step.events);
      return step.world;
    }, simulation.world);
    return { ...simulation, world, inputs: [], actions: [], events };
  };

/**
 * Takes one step at a time until `holds` says so of the world, taking the waiting input and actions into the first; fails if that does not come to pass within `limit` steps, 600 unless given. The events expected afterwards are those of every step it took.
 */
export const until =
  (
    holds: (world: World.World, named: (name: string) => World.Entity) => boolean,
    options: { readonly limit?: number } = {},
  ): Step =>
  (simulation) => {
    const limit = options.limit ?? 600;
    const named = (name: string) => entityOf(simulation, name);
    const events: Array<Event.Tagged> = [];
    const go = (current: Simulation, taken: number): Simulation => {
      if (holds(current.world, named)) {
        return { ...current, events };
      }
      if (taken === limit) {
        throw new Error(`it did not come to pass within ${limit} steps`);
      }
      const next = steps(1)(current);
      events.push(...next.events);
      return go(next, taken + 1);
    };
    return go(simulation, 0);
  };

/** Takes one step. */
export const step = (): Step => steps(1);

/** Takes as many steps as `seconds` take at the game's rate. */
export const seconds =
  (seconds: number): Step =>
  (simulation) =>
    steps(Math.round(seconds * simulation.game.stepRate))(simulation);

// EXPECTATIONS

/** Expects the entity named `name` to hold `component`, and hands its value to `assert`. */
export const expect =
  <Value>(name: string, component: Of<Value>, assert: (value: Value) => void): Step =>
  (simulation) =>
    Option.match(World.get(simulation.world, entityOf(simulation, name), component), {
      onNone: () => {
        throw new Error(`${name} holds no ${component.name}`);
      },
      onSome: (value) => {
        assert(value);
        return simulation;
      },
    });

/** Expects the entity named `name` to hold exactly `value` of `component`, compared as the component's schema encodes it. */
export const expectEqual =
  <Value>(name: string, component: Of<Value>, value: Value): Step =>
  (simulation) =>
    Option.match(World.get(simulation.world, entityOf(simulation, name), component), {
      onNone: () => {
        throw new Error(`${name} holds no ${component.name}`);
      },
      onSome: (held) => {
        const encode = Schema.encodeSync(
          Schema.fromJsonString(Schema.toCodecJson(component.schema)),
        );
        if (encode(held) !== encode(value)) {
          throw new Error(`${name} holds ${component.name} ${encode(held)}, not ${encode(value)}`);
        }
        return simulation;
      },
    });

/** Expects the entity named `name` not to hold `component`. */
export const expectNone =
  (name: string, component: Component.Any): Step =>
  (simulation) => {
    if (Option.isSome(World.get(simulation.world, entityOf(simulation, name), component))) {
      throw new Error(`${name} holds ${component.name}`);
    }
    return simulation;
  };

/** Expects `event` among the events of the steps last taken, and hands every one of them, in order, to `assert`. */
export const expectEvent =
  <Value>(
    event: Event.Event<string, Value>,
    assert: (values: ReadonlyArray<Value>) => void = () => {},
  ): Step =>
  (simulation) => {
    const values = simulation.events.filter((happened) => event.is(happened));
    if (values.length === 0) {
      throw new Error(`no ${event.tag} happened`);
    }
    assert(values);
    return simulation;
  };

/** Expects no `event` among the events of the steps last taken. */
export const expectNoEvent =
  (event: Event.Any): Step =>
  (simulation) => {
    if (simulation.events.some((happened) => event.is(happened))) {
      throw new Error(`${event.tag} happened`);
    }
    return simulation;
  };

/** Hands the whole world to `assert`, with a way to find a named entity, for what the other expectations cannot say. */
export const world =
  (assert: (world: World.World, named: (name: string) => World.Entity) => void): Step =>
  (simulation) => {
    assert(simulation.world, (name) => entityOf(simulation, name));
    return simulation;
  };

// READING

/** What the entity named `name` holds of `component` where `simulation`, a story told, ended: for comparing one story with another. */
export const valueOf = <Value>(simulation: Simulation, name: string, component: Of<Value>): Value =>
  Option.match(World.get(simulation.world, entityOf(simulation, name), component), {
    onNone: () => {
      throw new Error(`${name} holds no ${component.name}`);
    },
    onSome: (value) => value,
  });
