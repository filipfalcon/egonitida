import { expect, it } from '@effect/vitest';
import { Scene } from '@lightocean/client';
import { Pointing, Story } from '@lightocean/core';
import { Effect, Option } from 'effect';
import * as Three from 'three/webgpu';
import * as Colour from '#src/colour.ts';
import * as ColourView from '#src/colour.view.ts';

it.effect('draws each cube in its colour, where a click on it finds it', () =>
  Effect.gen(function* () {
    const told = Story.story(
      Colour.game,
      Story.given(Colour.state, { viewer: Colour.viewer }),
      Story.act('viewer', Pointing.Clicked, { entity: Colour.right }),
      Story.step(),
    );
    const scene = yield* Scene.make(ColourView.views);
    const camera = new Three.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 0, 8);
    camera.updateMatrixWorld();

    yield* scene.show(told.state);

    const at = new Three.Vector3(Colour.SPACING, 0, 0).project(camera);
    expect(Option.map(scene.pick(camera, at), ({ entity }) => entity)).toEqual(
      Option.some(Colour.right),
    );
    expect(
      Option.map(scene.find(ColourView.cubes, Colour.right), (cube) =>
        cube.material.color.getHex(),
      ),
    ).toEqual(Option.some(Colour.PALETTE[1]));
  }),
);
