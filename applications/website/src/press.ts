import { Component, Domain, Event, Game, Rule, System, State } from '@lightocean/core';
import { Option, Schema } from 'effect';

/**
 * The game the state press shows on the page of key terms, one like any other: a small globe with a tree and a volcano standing on it, and a dragon and a warrior going round it, each by its own stride, their health withering on unlucky steps. Its host holds time, and the page steps it by hand, one step a click; the press draws every state the page is shown.
 */

/** How whole a thing is at its healthiest, and the least it is let fall to before it is restored. */
const WHOLE = 14;
const LEAST = 4;

/** How much health an unlucky step takes. */
const WITHERING = 3;

/** How likely a step is to be unlucky for each thing that holds health. */
const CHANCE = 0.35;

// COMPONENTS

/** Where on the globe a thing stands: how far round it, and how far up from its equator, in degrees. */
export const Position = Component.make(
  'Position',
  Schema.Struct({ longitude: Schema.Finite, latitude: Schema.Finite }),
  { owner: 'simulation', network: 'server' },
);

/** What a thing is, and so the model it is drawn with. */
export const Shape = Component.make(
  'Shape',
  Schema.Struct({ kind: Schema.Literals(['Tree', 'Volcano', 'Dragon', 'Warrior']) }),
  { owner: 'rules', network: 'server' },
);

/** How far round the globe a thing goes in a step, in degrees. */
export const Stride = Component.make('Stride', Schema.Struct({ degrees: Schema.Finite }), {
  owner: 'rules',
  network: 'server',
});

/** How whole a thing is. */
export const Health = Component.make('Health', Schema.Struct({ current: Schema.Int }), {
  owner: 'rules',
  network: 'server',
});

// EVENTS

/** A step was unlucky for a thing that holds health. */
export const Withered = Event.make('Withered', { entity: Schema.Int });

// RULES

/** A withering takes from a thing's health, and one that would leave it too low restores it whole. */
const wither = Rule.on(Withered, {
  writes: [Health],
  emits: [],
  run: (context, { entity }) => {
    Option.map(context.get(entity, Health), ({ current }) => {
      const left = current - WITHERING;
      context.set(entity, Health, { current: left < LEAST ? WHOLE : left });
    });
  },
});

// SYSTEMS

/** Everything with a stride goes on round the globe by it. */
const travel = System.make({
  name: 'travel',
  reads: [Stride],
  writes: [Position],
  emits: [],
  run: (context) => {
    for (const [thing, position, { degrees }] of context.query(Position, Stride)) {
      context.set(thing, Position, {
        ...position,
        longitude: (position.longitude + degrees) % 360,
      });
    }
  },
});

/** Each step is unlucky for some of what holds health, as the game's randomness falls. */
const weather = System.make({
  name: 'weather',
  reads: [Health],
  writes: [],
  emits: [Withered],
  run: (context) => {
    for (const [entity] of context.query(Health)) {
      if (context.random() < CHANCE) {
        context.emit({ _tag: 'Withered', entity });
      }
    }
  },
});

// DOMAIN

export const domain = Domain.make({
  name: 'Press',
  requires: [],
  components: [Position, Shape, Stride, Health],
  actions: [],
  events: [Withered],
  systems: [travel, weather],
  rules: [wither],
});

/** The press's game: its one domain, two steps a second for as long as time is not held. */
export const game = Game.make({ stepRate: 2, domains: [domain] });

/** How a page joins the press: as an entity that holds nothing, which only watches. */
export const setup = {
  game,
  join: (state: State.State) => State.spawn(state, []),
  leave: State.despawn,
};

const [withTree, tree] = State.spawn(State.empty({ seed: 0x2f6b1d3 }), [
  Position.of({ longitude: 20, latitude: 40 }),
  Shape.of({ kind: 'Tree' }),
]);
const [withVolcano, volcano] = State.spawn(withTree, [
  Position.of({ longitude: 105, latitude: 30 }),
  Shape.of({ kind: 'Volcano' }),
]);
const [withDragon, dragon] = State.spawn(withVolcano, [
  Position.of({ longitude: 330, latitude: 50 }),
  Shape.of({ kind: 'Dragon' }),
  Stride.of({ degrees: 30 }),
  Health.of({ current: WHOLE }),
]);
const [withWarrior, warrior] = State.spawn(withDragon, [
  Position.of({ longitude: 60, latitude: 35 }),
  Shape.of({ kind: 'Warrior' }),
  Stride.of({ degrees: 12 }),
  Health.of({ current: WHOLE }),
]);

/** The state at tick 0: a tree, a volcano, a dragon, and a warrior on the globe, in that order. */
export const state = withWarrior;
export { dragon, tree, volcano, warrior };
