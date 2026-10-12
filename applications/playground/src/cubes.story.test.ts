import { expect, it } from '@effect/vitest';
import { Pointing, Story, State } from '@lightocean/core';
import { Option } from 'effect';
import * as Cubes from '#src/cubes.ts';

const given = Story.given(Cubes.state, { viewer: Cubes.viewer });

/** Every cube in `state`: where it stands in the grid, how it is painted, and what it is read out as. */
const cubesIn = (state: State.State) =>
  State.holding(state, [Cubes.Cube]).map((cube) => ({
    slot: Option.map(State.get(state, cube, Cubes.Cube), ({ slot }) => slot),
    shade: Option.map(State.get(state, cube, Cubes.Paint), ({ shade }) => shade),
    label: Option.map(State.get(state, cube, Pointing.Label), ({ text }) => text),
  }));

it('spawns a cube at every ask, each in a place of its own, painted the first colour, and read out by its number', () => {
  const told = Story.story(
    Cubes.game,
    given,
    Story.act('viewer', Cubes.AskedForCube, {}),
    Story.step(),
    Story.act('viewer', Cubes.AskedForCube, {}),
    Story.step(),
  );

  expect(cubesIn(told.state)).toEqual([
    { slot: Option.some(0), shade: Option.some(0), label: Option.some('Cube 1') },
    { slot: Option.some(1), shade: Option.some(0), label: Option.some('Cube 2') },
  ]);
});

it('paints a clicked cube the next colour of the palette, and round again after the last', () => {
  const [state, cube] = State.spawn(Cubes.state, Cubes.cubeAt(0));
  const click = [Story.act('viewer', Pointing.Clicked, { entity: cube }), Story.step()];

  Story.story(
    Cubes.game,
    Story.given(state, { viewer: Cubes.viewer, cube }),
    ...click,
    Story.expectEqual('cube', Cubes.Paint, { shade: 1 }),
    ...Array.from({ length: Cubes.PALETTE.length - 1 }, () => click).flat(),
    Story.expectEqual('cube', Cubes.Paint, { shade: 0 }),
  );
});

it('places cubes in rows of four, a row further back for every four', () => {
  expect([0, 3, 4].map((slot) => ({ x: Cubes.xOf(slot), z: Cubes.zOf(slot) }))).toEqual([
    { x: -3, z: 0 },
    { x: 3, z: 0 },
    { x: -3, z: -2 },
  ]);
});
