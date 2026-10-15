import { expect, it } from '@effect/vitest';
import { Scene } from '@nitida/client';
import { Story } from '@nitida/core';
import { Effect, Option } from 'effect';
import * as Cube from '#src/cube.ts';
import * as CubeView from '#src/cube.view.ts';

it.effect('draws a cube turned as far as it has turned', () =>
  Effect.gen(function* () {
    const turned = Story.story(
      Cube.game,
      Story.given(Cube.state, { cube: Cube.cube }),
      Story.seconds(1),
    );
    const scene = yield* Scene.make(CubeView.views);

    yield* scene.show(turned.state);

    expect(Option.map(scene.find(CubeView.cubes, Cube.cube), (mesh) => mesh.rotation.y)).toEqual(
      Option.some(Story.valueOf(turned, 'cube', Cube.Spin).angle),
    );
  }),
);
