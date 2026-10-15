import { describe, expect, it } from '@effect/vitest';
import { State } from '@nitida/core';
import { Option } from 'effect';
import * as Score from '#src/score.ts';
import { told } from '#src/main.ts';

describe('what the page is told of the round', () => {
  it('is its hits and the whole seconds left while it plays, counting down with the steps', () => {
    const later = { ...Score.state, tick: Score.state.tick + 31 };

    expect(told(Score.state)).toEqual(
      Option.some({ _tag: 'Playing', hits: 0, secondsLeft: Score.ROUND_SECONDS }),
    );
    expect(told(later)).toEqual(
      Option.some({ _tag: 'Playing', hits: 0, secondsLeft: Score.ROUND_SECONDS - 1 }),
    );
  });

  it('is the round as it is once it is over', () => {
    const [saved] = State.spawn(State.empty({ seed: 1 }), [
      Score.Round.of({ _tag: 'Saved', hits: 3, best: 7 }),
    ]);

    expect(told(saved)).toEqual(Option.some({ _tag: 'Saved', hits: 3, best: 7 }));
  });

  it('is nothing in a state with no round', () => {
    expect(told(State.empty({ seed: 1 }))).toEqual(Option.none());
  });
});
