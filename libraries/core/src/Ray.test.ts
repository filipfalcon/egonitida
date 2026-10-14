import { describe, expect, it } from '@effect/vitest';
import { Option } from 'effect';
import * as Ray from '#src/Ray.ts';

/** A wall a metre thick across the way ahead, from `-z` 4 to 5, two metres high, as wide as can be. */
const wall: Ray.Box = {
  min: { x: -10, y: 0, z: -5 },
  max: { x: 10, y: 2, z: -4 },
};

/** A ray from the middle of the floor, a metre up, going `-z`. */
const ahead: Ray.Ray = { origin: { x: 0, y: 1, z: 0 }, direction: { x: 0, y: 0, z: -1 } };

describe('a ray', () => {
  it('enters a box where it first meets its side, as far along as it went', () => {
    expect(Option.getOrThrow(Ray.entering(ahead, wall, 10))).toBeCloseTo(4);
  });

  it('enters nothing it meets only past how far it looks, or never meets', () => {
    const away: Ray.Ray = { ...ahead, direction: { x: 0, y: 0, z: 1 } };

    expect(Ray.entering(ahead, wall, 3)).toEqual(Option.none());
    expect(Ray.entering(away, wall, 10)).toEqual(Option.none());
  });

  it('enters nothing it starts within, as it never crosses into it', () => {
    const within: Ray.Ray = { ...ahead, origin: { x: 0, y: 1, z: -4.5 } };

    expect(Ray.entering(within, wall, 10)).toEqual(Option.none());
  });

  it('passes over a box lower than the way it goes, and meets one it rises into', () => {
    const over: Ray.Ray = { origin: { x: 0, y: 3, z: 0 }, direction: { x: 0, y: 0, z: -1 } };
    const rising: Ray.Ray = {
      origin: { x: 0, y: 0, z: 0 },
      direction: { x: 0, y: 0.6, z: -0.8 },
    };

    expect(Ray.entering(over, wall, 10)).toEqual(Option.none());
    // It rises to a height of 3 by the wall's near side, 5 along it: over it.
    expect(Ray.entering(rising, wall, 10)).toEqual(Option.none());
    // Rising a quarter as steeply, it is 1.5 high by then, 10 along it, and meets the wall's side.
    const gentle: Ray.Ray = {
      origin: { x: 0, y: 0, z: 0 },
      direction: { x: 0, y: 0.15, z: -0.4 },
    };
    expect(Option.getOrThrow(Ray.entering(gentle, wall, 20))).toBeCloseTo(10);
  });

  it('runs along a side it is level with without crossing into the box', () => {
    const alongTop: Ray.Ray = {
      origin: { x: -20, y: 2, z: -4.5 },
      direction: { x: 1, y: 0, z: 0 },
    };
    const throughMiddle: Ray.Ray = {
      origin: { x: -20, y: 1, z: -4.5 },
      direction: { x: 1, y: 0, z: 0 },
    };

    expect(Ray.entering(alongTop, wall, 40)).toEqual(Option.none());
    expect(Option.getOrThrow(Ray.entering(throughMiddle, wall, 40))).toBeCloseTo(10);
  });

  it('goes as far as the nearest of many boxes it enters, or as far as it looks', () => {
    const nearer: Ray.Box = { min: { x: -1, y: 0, z: -2.5 }, max: { x: 1, y: 2, z: -2 } };

    expect(Ray.reach(ahead, [wall, nearer], 10)).toBeCloseTo(2);
    expect(Ray.reach(ahead, [], 10)).toBeCloseTo(10);
  });

  it('stands a box on the ground as high as told, or as high as there is', () => {
    expect(Ray.standing({ minX: 1, maxX: 2, minZ: 3, maxZ: 4 }, 5)).toEqual({
      min: { x: 1, y: 0, z: 3 },
      max: { x: 2, y: 5, z: 4 },
    });
    expect(Ray.standing({ minX: 1, maxX: 2, minZ: 3, maxZ: 4 }).max.y).toBe(Infinity);
  });
});
