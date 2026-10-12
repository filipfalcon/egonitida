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

describe('Viewport.pointOf', () => {
  const canvas = { left: 100, top: 50, width: 400, height: 200 };

  it('is where a pointer is on the canvas, from -1 to 1 across it and up it', () => {
    expect(Viewport.pointOf({ clientX: 300, clientY: 150 }, canvas)).toEqual({ x: 0, y: 0 });
    expect(Viewport.pointOf({ clientX: 100, clientY: 50 }, canvas)).toEqual({ x: -1, y: 1 });
    expect(Viewport.pointOf({ clientX: 500, clientY: 250 }, canvas)).toEqual({ x: 1, y: -1 });
  });
});

describe('Viewport.occlusion', () => {
  it('shades what lies within half a unit, at full strength, worked out at half the resolution, unless told otherwise', () => {
    expect(Viewport.occlusion()).toEqual({ radius: 0.5, strength: 1, resolution: 0.5 });
  });

  it('keeps what it is told', () => {
    expect(Viewport.occlusion({ radius: 2, strength: 0.6, resolution: 1 })).toEqual({
      radius: 2,
      strength: 0.6,
      resolution: 1,
    });
  });

  it('never shades less than nothing, nor works out at less than a tenth of the resolution or more than all of it', () => {
    expect(Viewport.occlusion({ radius: -1, strength: -1, resolution: 0 })).toEqual({
      radius: 0,
      strength: 0,
      resolution: 0.1,
    });
    expect(Viewport.occlusion({ resolution: 3 }).resolution).toBe(1);
  });
});
