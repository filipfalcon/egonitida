import { Component, Domain, Game, System, State } from '@lightocean/core';
import { Schema } from 'effect';

/**
 * The example over the network: a room many players share, hosted in a Durable Object, each player a walker of a colour of their own, steered by the keys. It adds one idea to those before: the game is not on the player's machine but across a network, and every page that opens the room sees the same walkers. A player's own walker is predicted, so it responds to their keys at once, and goes over to where the room says it is if the two disagree.
 */

/** How fast a walker walks, in metres a second. */
export const SPEED = 4;

/** How far from the middle the room's walls stand, in metres. */
export const HALF_SIZE = 6;

/** How many steps the room takes a second. */
const STEP_RATE = 30;

// COMPONENTS

/** Which way the player steers: a direction on the floor; one as long as one or longer walks a walker at its pace, and a shorter one, as a pad's stick tilted part way, slower. */
export const Steering = Component.make(
  'Steering',
  Schema.Struct({ x: Schema.Finite, z: Schema.Finite }),
  { owner: 'demand', network: 'predicted' },
);

/** Where a walker stands on the floor. */
export const Position = Component.make(
  'Position',
  Schema.Struct({ x: Schema.Finite, z: Schema.Finite }),
  { owner: 'simulation', network: 'predicted' },
);

/** A walker: the hue of its colour, in degrees, which tells it from the others. */
export const Walker = Component.make('Walker', Schema.Struct({ hue: Schema.Finite }), {
  owner: 'rules',
  network: 'server',
});

// SYSTEMS

/** Every walker walks the way its player steers, and no further than the room's walls. */
const walk = System.make({
  name: 'walk',
  reads: [Steering],
  writes: [Position],
  emits: [],
  run: (context) => {
    for (const [walker, steering, position] of context.query(Steering, Position)) {
      const length = Math.hypot(steering.x, steering.z);
      if (length > 0) {
        const pace = (SPEED * context.time.secondsPerStep) / Math.max(length, 1);
        context.set(walker, Position, {
          x: Math.min(HALF_SIZE, Math.max(-HALF_SIZE, position.x + steering.x * pace)),
          z: Math.min(HALF_SIZE, Math.max(-HALF_SIZE, position.z + steering.z * pace)),
        });
      }
    }
  },
});

// DOMAIN

export const domain = Domain.make({
  name: 'Walkers',
  requires: [],
  components: [Steering, Position, Walker],
  actions: [],
  events: [],
  systems: [walk],
  rules: [],
});

/** The example's game: walkers in a room. */
export const game = Game.make({ stepRate: STEP_RATE, domains: [domain] });

/** The room before anyone comes in: empty. */
export const state = State.empty({ seed: 1 });

/** A walker coming into `state`: in the middle, standing still, of a hue apart from those before it, as far round the colour wheel as the golden angle. */
export const join = (state: State.State) =>
  State.spawn(state, [
    Walker.of({ hue: (state.nextEntity * 137.5) % 360 }),
    Position.of({ x: 0, z: 0 }),
    Steering.of({ x: 0, z: 0 }),
  ]);
