import { Component, Domain, Game, Pointing, Rule, State } from '@lightocean/core';
import { Option, Schema } from 'effect';

/**
 * The second example: cubes that a click paints the next colour of a palette. It adds one idea to the first: a game a player plays by clicking what is drawn, through the `Pointing` domain the engine gives, whose `Clicked` the rules here handle. Its view is in `colour.view.ts`.
 */

/** The colours a cube steps through, one per click, as hex. */
export const PALETTE: ReadonlyArray<number> = [0x4f8cff, 0xff6b6b, 0x51cf66, 0xfcc419, 0xcc5de8];

/** How far apart the cubes stand. */
export const SPACING = 2;

// COMPONENTS

/** A cube, standing on a line at `x`. */
export const Cube = Component.make('Cube', Schema.Struct({ x: Schema.Finite }), {
  owner: 'rules',
  network: 'server',
});

/** Which colour of the palette a cube is painted. */
export const Paint = Component.make('Paint', Schema.Struct({ shade: Schema.Int }), {
  owner: 'rules',
  network: 'server',
});

// RULES

/** A click on a painted cube paints it the next colour, round to the first after the last. */
const repaint = Rule.on(Pointing.Clicked, {
  reads: [],
  writes: [Paint],
  emits: [],
  run: (context, { entity }) => {
    Option.map(context.get(entity, Paint), ({ shade }) =>
      context.set(entity, Paint, { shade: (shade + 1) % PALETTE.length }),
    );
  },
});

// DOMAIN

export const domain = Domain.make({
  name: 'Colour',
  requires: [Pointing.domain],
  components: [Cube, Paint],
  actions: [],
  events: [],
  systems: [],
  rules: [repaint],
});

export const game = Game.make({ stepRate: 30, domains: [Pointing.domain, domain] });

/** A cube at `x`, painted the first colour, read out as `label`. */
const cubeAt = (x: number, label: string) => [
  Cube.of({ x }),
  Paint.of({ shade: 0 }),
  Pointing.Label.of({ text: label }),
];

const [withLeft, left] = State.spawn(State.empty({ seed: 1 }), cubeAt(-SPACING, 'Left cube'));
const [withMiddle, middle] = State.spawn(withLeft, cubeAt(0, 'Middle cube'));
const [withRight, right] = State.spawn(withMiddle, cubeAt(SPACING, 'Right cube'));
/** Whoever looks at the cubes and clicks them: an entity that holds nothing, whom a click is from. */
const [withViewer, viewer] = State.spawn(withRight, []);

/** Three cubes in a row, painted the first colour. */
export const state = withViewer;
export { left, middle, right, viewer };
