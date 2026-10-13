import { Component, Domain, Game, Pointing, Rule, System, State } from '@lightocean/core';
import { Option, Schema } from 'effect';

/**
 * The website's game, shown at the top of its page: an ocean of lights in a square, swelling with the sea, where a click on a light sends a ripple out from it. It is a game like any other, so the page shows the engine by running it. Its view is in `ocean.view.ts`.
 */

/** How many lights stand across the ocean, and as many back. */
export const SIZE = 9;

/** How far a ripple spreads in a second, in places of the square. */
const RIPPLE_SPEED = 3;

/** How long a ripple runs before the sea is calm of it, in seconds. */
export const RIPPLE_SECONDS = 4;

/** How high a ripple lifts a light as it passes, when it has just set out. */
const RIPPLE_PEAK = 0.9;

/** How wide a ripple's crest is, in places of the square. */
const RIPPLE_WIDTH = 0.5;

// COMPONENTS

/** A light, in its place in the square: how far across it stands, and how far back. */
export const Light = Component.make(
  'Light',
  Schema.Struct({ across: Schema.Int, back: Schema.Int }),
  { owner: 'rules', network: 'server' },
);

/** How high a light stands above the calm sea. */
export const Swell = Component.make('Swell', Schema.Struct({ height: Schema.Finite }), {
  owner: 'simulation',
  network: 'server',
});

/** A ripple, spreading out from the light at its place since the step it set out. */
export const Ripple = Component.make(
  'Ripple',
  Schema.Struct({ across: Schema.Int, back: Schema.Int, since: Schema.Int }),
  { owner: 'rules', network: 'server' },
);

/** How high the sea alone lifts the light at its place, `seconds` into the game: two waves crossing, so no two places swell alike. */
const seaAt = (across: number, back: number, seconds: number) =>
  0.18 * Math.sin(0.7 * across + 1.3 * seconds) +
  0.14 * Math.sin(0.55 * back - 0.9 * seconds + 1.1);

/** How high `ripple` lifts the light at its place, `seconds` into the game, `secondsPerStep` a step: most where its crest is, less the longer it has run. */
const rippleAt = (
  ripple: Component.ValueOf<typeof Ripple>,
  across: number,
  back: number,
  seconds: number,
  secondsPerStep: number,
) => {
  const age = seconds - ripple.since * secondsPerStep;
  if (age < 0 || age >= RIPPLE_SECONDS) {
    return 0;
  }
  const off = Math.hypot(across - ripple.across, back - ripple.back) - RIPPLE_SPEED * age;
  return RIPPLE_PEAK * (1 - age / RIPPLE_SECONDS) * Math.exp(-(off * off) / RIPPLE_WIDTH);
};

// RULES

/** A click on a light sends a ripple out from it; a click on anything else does nothing. */
const ripple = Rule.on(Pointing.Clicked, {
  reads: [Light],
  writes: [],
  emits: [],
  spawns: [Ripple],
  run: (context, { entity }) => {
    Option.map(context.get(entity, Light), ({ across, back }) =>
      context.spawn([Ripple.of({ across, back, since: context.time.tick })]),
    );
  },
});

// SYSTEMS

/** A ripple that has run its time is gone. */
const calm = System.make({
  name: 'calm',
  reads: [Ripple],
  writes: [],
  emits: [],
  despawns: true,
  run: (context) => {
    const { tick, secondsPerStep } = context.time;
    for (const [entity, { since }] of context.query(Ripple)) {
      if ((tick - since) * secondsPerStep >= RIPPLE_SECONDS) {
        context.despawn(entity);
      }
    }
  },
});

/** Every light stands as high as the sea and every ripple on it lift it. */
const swell = System.make({
  name: 'swell',
  reads: [Light, Ripple],
  writes: [Swell],
  emits: [],
  run: (context) => {
    const { tick, secondsPerStep } = context.time;
    const seconds = tick * secondsPerStep;
    const ripples = context.query(Ripple);
    for (const [light, { across, back }] of context.query(Light)) {
      let height = seaAt(across, back, seconds);
      for (const [, passing] of ripples) {
        height += rippleAt(passing, across, back, seconds, secondsPerStep);
      }
      context.set(light, Swell, { height });
    }
  },
});

// DOMAIN

export const domain = Domain.make({
  name: 'Ocean',
  requires: [Pointing.domain],
  components: [Light, Swell, Ripple],
  actions: [],
  events: [],
  systems: [calm, swell],
  rules: [ripple],
});

/** The website's game: pointing at things, and the ocean. */
export const game = Game.make({ stepRate: 30, domains: [Pointing.domain, domain] });

/** A light at its place, on the calm sea, read out by where it stands. */
const lightOf = (across: number, back: number) => [
  Light.of({ across, back }),
  Swell.of({ height: 0 }),
  Pointing.Label.of({ text: `Light ${across + 1} across, ${back + 1} back` }),
];

/** Whoever clicks the lights: an entity that holds nothing, whom a click is from. */
const [withViewer, viewer] = State.spawn(State.empty({ seed: 1 }), []);

/** Every light of the square, row by row from the back, and a viewer. */
export const state = Array.from({ length: SIZE * SIZE }, (_, place) => place).reduce(
  (built, place) => State.spawn(built, lightOf(place % SIZE, Math.floor(place / SIZE)))[0],
  withViewer,
);
export { viewer };

/** The light at its place in the square, if one stands there. */
export const lightAt = (across: number, back: number): Option.Option<State.Entity> =>
  Option.fromNullishOr(
    State.holding(state, [Light]).find((light) =>
      Option.exists(
        State.get(state, light, Light),
        (place) => place.across === across && place.back === back,
      ),
    ),
  );
