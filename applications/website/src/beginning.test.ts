import { describe, expect, it } from '@effect/vitest';
import { Host, Story, State } from '@lightocean/core';
import { Effect } from 'effect';
import { TestClock } from 'effect/testing';
import * as Beginning from '#src/beginning.ts';
import * as Glance from '#src/glance.ts';

/** Lets `millis` of test time pass a little at a time, giving every fiber its turn. */
const pass = (millis: number) =>
  Effect.gen(function* () {
    for (let passed = 0; passed < millis; passed += 10) {
      yield* TestClock.adjust('10 millis');
      yield* Effect.yieldNow;
    }
  });

const [withViewer, viewer] = Glance.setup.join(Glance.state);

/** The telling as the viewer goes on to the step time starts ticking at, before the state begins from it. */
const atPoint = Story.story(
  Glance.game,
  Story.given(withViewer, { viewer }),
  Story.act('viewer', Glance.ChoseStart, {}),
  Story.step(),
  ...Array.from({ length: 5 }, () => [
    Story.seconds(1),
    Story.act('viewer', Glance.ChoseNext, {}),
    Story.step(),
  ]).flat(),
).state;

describe('a state begun by its host', () => {
  it.effect(
    'goes on from the state begun at its first tick, once time starts ticking in the telling',
    () =>
      Effect.gen(function* () {
        const host = yield* Host.make({ ...Glance.setup, state: atPoint, mayHold: true });
        yield* Beginning.serve(host);
        yield* pass(1500);
        const state = yield* host.state;

        expect(Glance.momentOf(state)).toBe('Step');
        expect(Glance.isAboutToBegin(state)).toBe(false);
        expect(state.tick).toBeLessThan(atPoint.tick);
        expect(State.holding(state, [Glance.Idea])).toEqual([]);
        expect(State.holding(state, [Glance.Eye])).toEqual([viewer]);
      }),
  );

  it.effect('leaves a state in which time has not started ticking as it is', () =>
    Effect.gen(function* () {
      const host = yield* Host.make({ ...Glance.setup, state: withViewer, mayHold: true });
      yield* Beginning.serve(host);
      yield* pass(1500);

      expect((yield* host.state).tick).toBeGreaterThan(4);
    }),
  );
});
