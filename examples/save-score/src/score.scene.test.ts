import { expect, it } from '@effect/vitest';
import { Scene } from '@egonitida/client';
import { Pointing, Story } from '@egonitida/core';
import { Effect, Option } from 'effect';
import * as Score from '#src/score.ts';
import * as ScoreView from '#src/score.view.ts';

it.effect('draws every target where it stands, and where it moved to once hit', () =>
  Effect.gen(function* () {
    const hit = Story.story(
      Score.game,
      Story.given(Score.state, { target: Score.firstTarget, player: Score.player }),
      Story.act('player', Pointing.Clicked, { entity: Score.firstTarget }),
      Story.step(),
    );
    const scene = yield* Scene.make(ScoreView.views);

    yield* scene.show(hit.state);

    const { x, z } = Story.valueOf(hit, 'target', Score.Target);
    expect(
      Option.map(scene.find(ScoreView.targets, Score.firstTarget), ({ position }) => [
        position.x,
        position.z,
      ]),
    ).toEqual(Option.some([x, z]));
  }),
);
