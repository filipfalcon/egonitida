import { Component, Domain, Maths, System } from '@nitida/core';
import { Schema } from 'effect';

/**
 * Where everything in the arena stands. Survivors walk and zombies shamble, so many domains move a body every step: this domain shares where one is, and keeps every body within the arena.
 */

/** How far from its middle the arena reaches, in metres. */
export const ARENA_RADIUS = 12;

// COMPONENTS

/** Where a body stands on the arena's floor, in metres from its middle. */
export const Position = Component.make(
  'Position',
  Schema.Struct({ x: Schema.Finite, z: Schema.Finite }),
  { owner: 'simulation', network: 'server' },
);

// SYSTEMS

/** A body that has gone past the edge of the arena is brought back to it. */
const keepInside = System.make({
  name: 'keepInside',
  reads: [],
  writes: [Position],
  emits: [],
  run: (context) => {
    for (const [body, { x, z }] of context.query(Position)) {
      const distance = Maths.hypot(x, z);
      if (distance > ARENA_RADIUS) {
        const scale = ARENA_RADIUS / distance;
        context.set(body, Position, { x: x * scale, z: z * scale });
      }
    }
  },
});

// DOMAIN

export const domain = Domain.make({
  name: 'Body',
  requires: [],
  components: [Position],
  shares: [Position],
  actions: [],
  events: [],
  systems: [keepInside],
  rules: [],
});
