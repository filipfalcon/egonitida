import { describe, expect, it } from '@effect/vitest';
import { Devices } from '@nitida/client';
import * as Steering from '#src/steering.ts';

/** What the player steers with `keys` held. */
const holding = (...keys: ReadonlyArray<string>) =>
  Steering.steer({ ...Devices.idle, keys: new Set(keys) }, Steering.start).steering;

describe('steering a walker', () => {
  it('is by the arrows or WASD, up the screen as away from the camera', () => {
    expect(holding('KeyD')).toEqual({ x: 1, z: 0 });
    expect(holding('ArrowUp').z).toBeCloseTo(-1);
    expect(holding('KeyS').z).toBeCloseTo(1);
  });

  it('is still while nothing is held', () => {
    expect(holding()).toEqual({ x: 0, z: 0 });
  });
});
