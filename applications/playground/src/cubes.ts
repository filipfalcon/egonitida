import { Action, Component, Domain, Game, Pointing, Rule, State } from '@egonitida/core';
import { Option, Schema } from 'effect';

/**
 * The playground's game: cubes a player asks for, one at a time, each in a place of its own in a grid, and painted the next colour of a palette at every click. Its UI, the button that asks for a cube and the count of them, is Foldkit's, in `main.ts`; its view is in `cubes.view.ts`.
 */

/** The colours a cube steps through, one per click, as hex. */
export const PALETTE: ReadonlyArray<number> = [0x4f8cff, 0xff6b6b, 0x51cf66, 0xfcc419, 0xcc5de8];

/** How many cubes stand in a row, and how far apart. */
const PER_ROW = 4;
const SPACING = 2;

/** Where across the cube in `slot` stands: four to a row, about the middle. */
export const xOf = (slot: number) => ((slot % PER_ROW) - (PER_ROW - 1) / 2) * SPACING;

/** How far back the cube in `slot` stands: a row further back for every four. */
export const zOf = (slot: number) => 0 - Math.floor(slot / PER_ROW) * SPACING;

// COMPONENTS

/** A cube, in the `slot`th place of the grid, counted in the order cubes were asked for. */
export const Cube = Component.make('Cube', Schema.Struct({ slot: Schema.Int }), {
  owner: 'rules',
  network: 'server',
});

/** Which colour of the palette a cube is painted. */
export const Paint = Component.make('Paint', Schema.Struct({ shade: Schema.Int }), {
  owner: 'rules',
  network: 'server',
});

/** A cube in the `slot`th place, painted the first colour, read out by its number. */
export const cubeAt = (slot: number) => [
  Cube.of({ slot }),
  Paint.of({ shade: 0 }),
  Pointing.Label.of({ text: `Cube ${slot + 1}` }),
];

// ACTIONS

/** The player asked for another cube. */
export const AskedForCube = Action.make('AskedForCube', {});

// RULES

/** A cube asked for stands in the next place of the grid. */
const spawnCube = Rule.on(AskedForCube, {
  reads: [Cube],
  writes: [],
  emits: [],
  spawns: [Cube, Paint, Pointing.Label],
  run: (context) => {
    context.spawn(cubeAt(context.query(Cube).length));
  },
});

/** A click on a cube paints it the next colour, round to the first after the last. */
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
  name: 'Cubes',
  requires: [Pointing.domain],
  components: [Cube, Paint],
  actions: [AskedForCube],
  events: [],
  systems: [],
  rules: [spawnCube, repaint],
});

/** The playground's game: pointing at things, and the cubes. */
export const game = Game.make({ stepRate: 30, domains: [Pointing.domain, domain] });

/** Whoever asks for cubes and clicks them: an entity that holds nothing, whom an ask or a click is from. */
const [withViewer, viewer] = State.spawn(State.empty({ seed: 1 }), []);

/** No cubes yet, and a viewer. */
export const state = withViewer;
export { viewer };
