import { expect, it } from '@effect/vitest';
import { Scene } from '@lightocean/client';
import { Pointing, Story, World } from '@lightocean/core';
import { Effect, Option } from 'effect';
import * as Cubes from '#src/cubes.ts';
import * as CubesView from '#src/cubes.view.ts';

/** Two cubes asked for, the second clicked once. */
const askedAndClicked = () => {
  const asked = Story.story(
    Cubes.game,
    Story.given(Cubes.world, { viewer: Cubes.viewer }),
    Story.act('viewer', Cubes.AskedForCube, {}),
    Story.act('viewer', Cubes.AskedForCube, {}),
    Story.step(),
  );
  const [first, second] = World.holding(asked.world, [Cubes.Cube]);
  return { asked, first, second };
};

it.effect('draws every cube where its place in the grid is, in the colour it is painted', () =>
  Effect.gen(function* () {
    const { asked, first, second } = askedAndClicked();
    const clicked = Option.match(Option.fromNullishOr(second), {
      onNone: () => asked,
      onSome: (cube) =>
        Story.step()(Story.act('viewer', Pointing.Clicked, { entity: cube })(asked)),
    });
    const scene = yield* Scene.make(CubesView.views);

    yield* scene.show(clicked.world);

    const drawn = (cube: World.Entity | undefined) =>
      Option.flatMap(Option.fromNullishOr(cube), (entity) => scene.find(CubesView.cubes, entity));
    expect(Option.map(drawn(first), ({ position }) => [position.x, position.z])).toEqual(
      Option.some([Cubes.xOf(0), Cubes.zOf(0)]),
    );
    expect(Option.map(drawn(second), ({ position }) => position.x)).toEqual(
      Option.some(Cubes.xOf(1)),
    );
    expect(Option.map(drawn(first), ({ material }) => material.color.getHex())).toEqual(
      Option.some(Cubes.PALETTE[0]),
    );
    expect(Option.map(drawn(second), ({ material }) => material.color.getHex())).toEqual(
      Option.some(Cubes.PALETTE[1]),
    );
  }),
);

it.effect('turns every cube as time goes on', () =>
  Effect.gen(function* () {
    const { asked, first } = askedAndClicked();
    const later = Story.seconds(1)(asked);
    const scene = yield* Scene.make(CubesView.views);
    const turn = () =>
      Option.flatMap(Option.fromNullishOr(first), (cube) =>
        Option.map(scene.find(CubesView.cubes, cube), ({ quaternion }) => quaternion.clone()),
      );

    yield* scene.show(asked.world);
    const before = turn();
    yield* scene.show(later.world);
    const after = turn();

    expect(
      Option.map(Option.all([before, after]), ([one, other]) => one.angleTo(other) > 0.5),
    ).toEqual(Option.some(true));
  }),
);
