import { describe, expect, it } from '@effect/vitest';
import { Pointing, Story, World } from '@lightocean/core';
import { Option } from 'effect';
import * as Score from '#src/score.ts';

const given = Story.given(Score.world, {
  round: Score.round,
  target: Score.firstTarget,
  player: Score.player,
});

const hit = [Story.act('player', Pointing.Clicked, { entity: Score.firstTarget }), Story.step()];

describe('a round', () => {
  it('counts a hit on a target, which moves somewhere else to be hit again', () => {
    const before = World.get(Score.world, Score.firstTarget, Score.Target);

    Story.story(
      Score.game,
      given,
      ...hit,
      Story.expect('round', Score.Round, (round) =>
        expect(round).toMatchObject({ _tag: 'Playing', hits: 1 }),
      ),
      Story.expect('target', Score.Target, (moved) =>
        expect(Option.some(moved)).not.toEqual(before),
      ),
    );
  });

  it('counts nothing clicked that is no target', () => {
    Story.story(
      Score.game,
      given,
      Story.act('player', Pointing.Clicked, { entity: Score.round }),
      Story.step(),
      Story.expect('round', Score.Round, (round) => expect(round).toMatchObject({ hits: 0 })),
    );
  });

  it('ends when its time is up, and asks for the score to be saved', () => {
    Story.story(
      Score.game,
      given,
      ...hit,
      ...hit,
      Story.seconds(Score.ROUND_SECONDS),
      Story.expectCommand(Score.SaveScore, (saved) => expect(saved).toEqual([{ score: 2 }])),
      Story.expectEqual('round', Score.Round, { _tag: 'Saving', hits: 2 }),
      ...hit,
      Story.expectEqual('round', Score.Round, { _tag: 'Saving', hits: 2 }),
    );
  });

  it('shows the best score once it is saved, or why it was not', () => {
    const ended = [...hit, Story.seconds(Score.ROUND_SECONDS)];

    Story.story(
      Score.game,
      given,
      ...ended,
      Story.resolve(Score.SaveScore, Score.ScoreSaved, { best: 7 }),
      Story.step(),
      Story.expectEqual('round', Score.Round, { _tag: 'Saved', hits: 1, best: 7 }),
    );
    Story.story(
      Score.game,
      given,
      ...ended,
      Story.resolve(Score.SaveScore, Score.ScoreNotSaved, { reason: 'No scores kept.' }),
      Story.step(),
      Story.expectEqual('round', Score.Round, {
        _tag: 'Unsaved',
        hits: 1,
        reason: 'No scores kept.',
      }),
    );
  });

  it('starts again when the player chooses, once the last round is over', () => {
    Story.story(
      Score.game,
      given,
      Story.act('player', Score.ChoseNewRound, {}),
      Story.step(),
      Story.expect('round', Score.Round, (round) =>
        expect(round).toMatchObject({ _tag: 'Playing', hits: 0 }),
      ),
      ...hit,
      Story.seconds(Score.ROUND_SECONDS),
      Story.resolve(Score.SaveScore, Score.ScoreSaved, { best: 1 }),
      Story.step(),
      Story.act('player', Score.ChoseNewRound, {}),
      Story.step(),
      Story.expect('round', Score.Round, (round) =>
        expect(round).toMatchObject({ _tag: 'Playing', hits: 0 }),
      ),
    );
  });
});
