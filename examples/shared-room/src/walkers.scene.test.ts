import { expect, it } from '@effect/vitest';
import { Scene } from '@lightocean/client';
import { Story } from '@lightocean/core';
import { Effect, Option } from 'effect';
import * as Walkers from '#src/walkers.ts';
import * as WalkersView from '#src/walkers.view.ts';

it.effect('draws every walker where it stands, in its own colour', () =>
  Effect.gen(function* () {
    const [once, first] = Walkers.join(Walkers.state);
    const [twice, second] = Walkers.join(once);
    const walked = Story.story(
      Walkers.game,
      Story.given(twice, { first, second }),
      Story.input('first', Walkers.Steering, { x: 1, z: 0 }),
      Story.seconds(1),
    );
    const scene = yield* Scene.make(WalkersView.views);

    yield* scene.show(walked.state);

    const drawn = (walker: number) =>
      scene.find(WalkersView.walkers, walker).pipe(
        Option.map(({ position, material }) => ({
          x: position.x,
          z: position.z,
          colour: material.color.getHexString(),
        })),
      );
    const at = Story.valueOf(walked, 'first', Walkers.Position);
    expect(Option.map(drawn(first), ({ x, z }) => [x, z])).toEqual(Option.some([at.x, at.z]));
    expect(Option.map(drawn(first), ({ colour }) => colour)).not.toEqual(
      Option.map(drawn(second), ({ colour }) => colour),
    );
  }),
);
