import { expect, it } from '@effect/vitest';
import { Scene } from '@lightocean/client';
import { Pointing, Story, State } from '@lightocean/core';
import { Effect, Option } from 'effect';
import * as Three from 'three/webgpu';
import * as Cubes from '#src/cubes.ts';
import * as CubesView from '#src/cubes.view.ts';
import * as Look from '#src/look.ts';

/** The cubes seen from `viewpoint`, looked around as `look` turned the player. */
const seen = (viewpoint: CubesView.Viewpoint, look: Look.Look = Look.start): CubesView.Seen => ({
  viewpoint,
  look,
});

/** Two cubes asked for, the second clicked once. */
const askedAndClicked = () => {
  const asked = Story.story(
    Cubes.game,
    Story.given(Cubes.state, { viewer: Cubes.viewer }),
    Story.act('viewer', Cubes.AskedForCube, {}),
    Story.act('viewer', Cubes.AskedForCube, {}),
    Story.step(),
  );
  const [first, second] = State.entitiesHolding(asked.state, [Cubes.Cube]);
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
    const scene = yield* Scene.make(CubesView.views, Option.some(Cubes.viewer), () =>
      seen('Ahead'),
    );

    yield* scene.show(clicked.state);

    const drawn = (cube: State.Entity | undefined) =>
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
    const scene = yield* Scene.make(CubesView.views, Option.some(Cubes.viewer), () =>
      seen('Ahead'),
    );
    const turn = () =>
      Option.flatMap(Option.fromNullishOr(first), (cube) =>
        Option.map(scene.find(CubesView.cubes, cube), ({ quaternion }) => quaternion.clone()),
      );

    yield* scene.show(asked.state);
    const before = turn();
    yield* scene.show(later.state);
    const after = turn();

    expect(
      Option.map(Option.all([before, after]), ([one, other]) => one.angleTo(other) > 0.5),
    ).toEqual(Option.some(true));
  }),
);

it.effect(
  'looks at the cubes from where the page says the player looks from, with nothing of it in the state',
  () =>
    Effect.gen(function* () {
      const { asked } = askedAndClicked();
      const viewpoint: { current: CubesView.Viewpoint } = { current: 'Ahead' };
      const scene = yield* Scene.make(CubesView.views, Option.some(Cubes.viewer), () =>
        seen(viewpoint.current),
      );
      const forward = new Three.Vector3();

      yield* scene.show(asked.state);
      const ahead = scene.camera.getWorldDirection(forward).clone();
      viewpoint.current = 'Overhead';
      yield* scene.show(asked.state);
      const overhead = scene.camera.getWorldDirection(forward).clone();

      // Ahead, the camera looks mostly forward, into the grid; overhead, straight down onto it.
      expect(ahead.dot(new Three.Vector3(0, 0, -1))).toBeGreaterThan(0.9);
      expect(overhead.dot(new Three.Vector3(0, -1, 0))).toBeCloseTo(1);
    }),
);

it.effect(
  'looks around from where the player looks from, as far as their devices turned them',
  () =>
    Effect.gen(function* () {
      const { asked } = askedAndClicked();
      const turned: Look.Look = { ...Look.start, yaw: Math.PI / 2 };
      const scene = yield* Scene.make(CubesView.views, Option.some(Cubes.viewer), () =>
        seen('Ahead', turned),
      );

      yield* scene.show(asked.state);
      const facing = scene.camera.getWorldDirection(new Three.Vector3());

      // Turned a quarter to the left, the camera looks along -x, still a little down onto the grid.
      expect(facing.dot(new Three.Vector3(-1, 0, 0))).toBeGreaterThan(0.9);
      expect(facing.y).toBeLessThan(0);
    }),
);
