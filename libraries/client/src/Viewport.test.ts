import { describe, expect, it } from '@effect/vitest';
import { Option } from 'effect';
import * as Viewport from '#src/Viewport.ts';

describe('Viewport.secondsBetween', () => {
  it('is nothing at the first frame', () => {
    expect(Viewport.secondsBetween(Option.none(), 1000)).toBe(0);
  });

  it('is the time between the display’s moments for two frames', () => {
    expect(Viewport.secondsBetween(Option.some(1000), 1016.5)).toBeCloseTo(0.0165);
  });

  it('is never less than nothing, nor more than a short step after a long pause', () => {
    expect(Viewport.secondsBetween(Option.some(1000), 990)).toBe(0);
    expect(Viewport.secondsBetween(Option.some(1000), 61_000)).toBe(0.25);
  });
});
