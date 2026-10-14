import { Action, Component, Domain, Game, Rule, State } from '@lightocean/core';
import { Option, Schema } from 'effect';

/**
 * The sixth example: a figure her player shapes, her chest fuller, her hips wider or narrower, her legs longer or shorter, a step at a time. How she is shaped is part of the state, which any other player would see, set by her player's actions; how a model is reshaped by it is the views', through `Shaping`, in `figure.view.ts`.
 */

/** The figure's dials, in the order her player goes through them. */
export const DIALS = ['chest', 'hips', 'legs'] as const;

/** One of the figure's dials. */
export type Dial = (typeof DIALS)[number];

/** A turn of one dial, a step toward less or toward more. */
export interface Turn {
  readonly dial: Dial;
  readonly toward: 'Less' | 'More';
}

/** How far one turn of a dial goes. */
export const STEP = 0.25;

/** How far a dial turns either way at most: a whole. */
export const FARTHEST = 1;

// COMPONENTS

/** How a figure is shaped, by a value for each of her dials: nothing as she was made, a whole at most either way. */
export const Shape = Component.make(
  'Shape',
  Schema.Struct({ chest: Schema.Finite, hips: Schema.Finite, legs: Schema.Finite }),
  { owner: 'rules', network: 'server' },
);

/** A figure as she was made. */
export const asMade: Component.ValueOf<typeof Shape> = { chest: 0, hips: 0, legs: 0 };

// ACTIONS

/** The player turned one of her figure's dials a step, toward less or toward more. */
export const TurnedDial = Action.make('TurnedDial', {
  dial: Schema.Literals(DIALS),
  toward: Schema.Literals(['Less', 'More']),
});

// RULES

/** A turned dial goes a step toward less or more, never past a whole either way. */
const turnDial = Rule.on(TurnedDial, {
  reads: [],
  writes: [Shape],
  emits: [],
  run: (context, { player, dial, toward }) => {
    Option.map(context.get(player, Shape), (shape) => {
      const turned = shape[dial] + (toward === 'More' ? STEP : -STEP);
      context.set(player, Shape, {
        ...shape,
        [dial]: Math.min(Math.max(turned, -FARTHEST), FARTHEST),
      });
    });
  },
});

// DOMAIN

export const domain = Domain.make({
  name: 'Figure',
  requires: [],
  components: [Shape],
  actions: [TurnedDial],
  events: [],
  systems: [],
  rules: [turnDial],
});

export const game = Game.make({ stepRate: 30, domains: [domain] });

/** Nobody yet: every player who joins is a figure of her own. */
export const state = State.empty({ seed: 1 });

/** A player joins as a figure, shaped as she was made. */
export const join = (joined: State.State) => State.spawn(joined, [Shape.of(asMade)]);
