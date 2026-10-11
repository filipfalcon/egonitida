import { expect, it } from '@effect/vitest';
import { Scene } from '@lightocean/client';
import { Story, World } from '@lightocean/core';
import { Effect, Option } from 'effect';
import * as Ocean from '#src/ocean.ts';
import * as OceanView from '#src/ocean.view.ts';

/** The ocean a second on, where no two places swell alike. */
const swelling = Story.story(Ocean.game, Story.given(Ocean.world), Story.seconds(1)).world;

it.effect('draws every light at its place in the square, as high as it swells', () =>
  Effect.gen(function* () {
    const scene = yield* Scene.make(OceanView.views);

    yield* scene.show(swelling);

    for (const light of World.holding(swelling, [Ocean.Light])) {
      const drawn = scene.find(OceanView.lights, light);
      const expected = Option.all([
        World.get(swelling, light, Ocean.Light),
        World.get(swelling, light, Ocean.Swell),
      ]);
      expect(Option.map(drawn, ({ position }) => [position.x, position.y, position.z])).toEqual(
        Option.map(expected, ([{ across, back }, { height }]) => [
          OceanView.xOf(across),
          height,
          OceanView.zOf(back),
        ]),
      );
    }
  }),
);

it.effect('draws a light the brighter the higher it stands', () =>
  Effect.gen(function* () {
    const scene = yield* Scene.make(OceanView.views);
    yield* scene.show(swelling);

    const lights = World.holding(swelling, [Ocean.Light]).flatMap((light) =>
      Option.toArray(
        Option.all([
          World.get(swelling, light, Ocean.Swell),
          Option.map(
            scene.find(OceanView.lights, light),
            ({ material }) => material.emissive.getHSL({ h: 0, s: 0, l: 0 }).l,
          ),
        ]),
      ),
    );
    const byHeight = lights.toSorted(([one], [other]) => one.height - other.height);
    const lowest = byHeight[0];
    const highest = byHeight.at(-1);

    expect(lowest !== undefined && highest !== undefined && lowest[1] < highest[1]).toBe(true);
  }),
);
