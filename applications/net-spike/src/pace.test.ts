import { describe, expect, it } from '@effect/vitest';
import * as Pace from '#src/pace.ts';

// 30 steps a second from the moment 1000, catching up at most 5 steps at once.
const started = Pace.start({ now: 1000, stepRate: 30, maxSteps: 5 });

describe('pace', () => {
  it('owes no step before a step’s time has passed', () => {
    expect(Pace.due(started, 0, 1020).steps).toBe(0);
  });

  it('owes one step once a step’s time has passed', () => {
    expect(Pace.due(started, 0, 1034).steps).toBe(1);
  });

  it('owes every step a late timer missed', () => {
    // 100 ms at 30 Hz is exactly three steps, even though 1000 / 30 is not exact in floating point.
    expect(Pace.due(started, 0, 1100).steps).toBe(3);
  });

  it('does not owe steps already taken', () => {
    expect(Pace.due(started, 3, 1100).steps).toBe(0);
  });

  it('catches up at most the maximum after a stall, dropping the rest of the lost time', () => {
    // A one-second stall owes 30 steps; only 5 are taken, and the other 25 are given up for good.
    const stalled = Pace.due(started, 0, 2000);
    expect(stalled.steps).toBe(5);

    expect(Pace.due(stalled.pace, 5, 2000).steps).toBe(0);
    expect(Pace.due(stalled.pace, 5, 2034).steps).toBe(1);
  });

  it('reports how many steps it gave up', () => {
    expect(Pace.due(started, 0, 2000).pace.skipped).toBe(25);
  });

  it('keeps the real rate however irregularly it is asked', () => {
    const askedAt = [1013, 1071, 1072, 1140, 1199, 1250, 1301, 1333, 1400, 1466, 2000];
    const taken = askedAt.reduce(
      (state, now) => {
        const { steps, pace } = Pace.due(state.pace, state.done, now);
        return { pace, done: state.done + steps };
      },
      { pace: Pace.start({ now: 1000, stepRate: 30, maxSteps: 100 }), done: 0 },
    );

    expect(taken.done).toBe(30);
  });
});
