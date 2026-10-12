import { Component, Domain, Game, System, State } from '@lightocean/core';
import { Schema } from 'effect';

/**
 * The first example: a cube that turns. It is the smallest game there is: one component, one system, and one domain, with one view in `cube.view.ts` to draw it.
 */

// COMPONENTS

/** A cube turning about its upright: how far it has turned, in radians, and how many turns it makes a second. */
export const Spin = Component.make(
  'Spin',
  Schema.Struct({
    angle: Schema.Finite.annotate({ interpolate: 'angle' }),
    speed: Schema.Finite,
  }),
  { owner: 'simulation', network: 'server' },
);

// SYSTEMS

/** Every cube turns on by its speed. */
const turn = System.make({
  name: 'turn',
  reads: [],
  writes: [Spin],
  emits: [],
  run: (context) => {
    for (const [cube, spin] of context.query(Spin)) {
      const angle = spin.angle + spin.speed * Math.PI * 2 * context.time.secondsPerStep;
      context.set(cube, Spin, { ...spin, angle });
    }
  },
});

// DOMAIN

export const domain = Domain.make({
  name: 'Cube',
  requires: [],
  components: [Spin],
  actions: [],
  events: [],
  systems: [turn],
  rules: [],
});

export const game = Game.make({ stepRate: 60, domains: [domain] });

/** One cube, turning once every four seconds. */
export const [state, cube] = State.spawn(State.empty({ seed: 1 }), [
  Spin.of({ angle: 0, speed: 0.25 }),
]);
