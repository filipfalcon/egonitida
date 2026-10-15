import { Action, Component, Domain, Event, Maths, Rule, State, System } from '@egonitida/core';
import { Option, Schema } from 'effect';
import * as Body from '#src/body.ts';

/**
 * Whoever the horde comes for: a survivor walks where the stick points, has health a bite takes from, and counts the zombies they kill. Dead, they may choose to rise again.
 */

/** The health a survivor rises with. */
export const HEALTH = 100;

/** How fast a survivor walks, in metres a second. */
export const SPEED = 4;

// COMPONENTS

/** What the player demands: which way to walk, as a direction on the floor no longer than one, and which way to aim, in radians from x towards z. */
export const Stick = Component.make(
  'Stick',
  Schema.Struct({
    x: Schema.Finite,
    z: Schema.Finite,
    aim: Schema.Finite.annotate({ interpolate: 'angle' }),
  }),
  { owner: 'demand', network: 'predicted' },
);

/** Whether a survivor lives: alive, with the health left and the tick they last rose at, or dead since a tick. */
export const Life = Component.make(
  'Life',
  Schema.Union([
    Schema.TaggedStruct('Alive', { health: Schema.Int, since: Schema.Int }),
    Schema.TaggedStruct('Dead', { at: Schema.Int }),
  ]),
  { owner: 'rules', network: 'server' },
);
export type Life = typeof Life.schema.Type;

/** A survivor alive and whole, risen at `since`. */
export const alive = (since: number): Life => ({ _tag: 'Alive', health: HEALTH, since });

/** How many zombies a survivor has killed since rising. */
export const Tally = Component.make('Tally', Schema.Struct({ kills: Schema.Int }), {
  owner: 'rules',
  network: 'server',
});

// ACTIONS

/** The player pulled the trigger, aiming however the stick aims. */
export const PulledTrigger = Action.make('PulledTrigger', {});

/** The player chose to rise again. */
export const ChoseRestart = Action.make('ChoseRestart', {});

// EVENTS

/** Something bit a survivor. */
export const Bitten = Event.make('Bitten', { survivor: Schema.Int, damage: Schema.Int });

/** A survivor killed a zombie. */
export const Killed = Event.make('Killed', { survivor: Schema.Int });

/** A dead survivor rose again, whole. */
export const Revived = Event.make('Revived', { survivor: Schema.Int });

// RULES

/** A bite takes from a living survivor's health, and one that takes the last of it kills them. */
const takeBite = Rule.on(Bitten, {
  reads: [],
  writes: [Life],
  emits: [],
  run: (context, { survivor, damage }) => {
    Option.map(context.get(survivor, Life), (life) => {
      if (life._tag === 'Dead') {
        return;
      }
      const health = life.health - damage;
      if (health > 0) {
        context.set(survivor, Life, { ...life, health });
        return;
      }
      context.set(survivor, Life, { _tag: 'Dead', at: context.time.tick });
    });
  },
});

/** A kill is counted to whoever made it. */
const count = Rule.on(Killed, {
  reads: [],
  writes: [Tally],
  emits: [],
  run: (context, { survivor }) => {
    Option.map(context.get(survivor, Tally), (tally) =>
      context.set(survivor, Tally, { ...tally, kills: tally.kills + 1 }),
    );
  },
});

/** A dead survivor who chooses to rise again whole, with no kills; a living one cannot. */
const restart = Rule.on(ChoseRestart, {
  reads: [],
  writes: [Life, Tally],
  emits: [Revived],
  run: (context, { player }) => {
    Option.map(
      Option.filter(context.get(player, Life), ({ _tag }) => _tag === 'Dead'),
      () => {
        context.set(player, Life, alive(context.time.tick));
        Option.map(context.get(player, Tally), (tally) =>
          context.set(player, Tally, { ...tally, kills: 0 }),
        );
        context.emit({ _tag: 'Revived', survivor: player });
      },
    );
  },
});

// SYSTEMS

/** A living survivor walks the way the stick points. */
const walk = System.make({
  name: 'walk',
  reads: [Life, Stick],
  writes: [Body.Position],
  emits: [],
  run: (context) => {
    for (const [survivor, life, stick, position] of context.query(Life, Stick, Body.Position)) {
      const length = Maths.hypot(stick.x, stick.z);
      if (life._tag === 'Alive' && length > 0) {
        const pace = (SPEED * context.time.secondsPerStep) / Math.max(length, 1);
        context.set(survivor, Body.Position, {
          x: position.x + stick.x * pace,
          z: position.z + stick.z * pace,
        });
      }
    }
  },
});

// DOMAIN

export const domain = Domain.make({
  name: 'Survivor',
  requires: [Body.domain],
  components: [Stick, Life, Tally],
  actions: [PulledTrigger, ChoseRestart],
  events: [Bitten, Killed, Revived],
  systems: [walk],
  rules: [takeBite, count, restart],
});

/** A survivor joining `state`: alive at its middle, with nothing in hand and nothing killed. */
export const join = (state: State.State) =>
  State.spawn(state, [
    Body.Position.of({ x: 0, z: 0 }),
    Life.of(alive(state.tick)),
    Tally.of({ kills: 0 }),
    Stick.of({ x: 0, z: 0, aim: 0 }),
  ]);
