import { describe, expect, it } from '@effect/vitest';
import { Devices } from '@lightocean/client';
import * as Look from '#src/look.ts';

/** The devices with nothing held but `keys`. */
const holding = (...keys: ReadonlyArray<string>): Devices.Reading => ({
  ...Devices.idle,
  keys: new Set(keys),
});

/** `look` played on for `frames` frames of `seconds` each, `devices` held throughout. */
const playedFor = (devices: Devices.Reading, frames: number, seconds: number, from = Look.start) =>
  Array.from({ length: frames }).reduce<Look.Look>(
    (before) => Look.look(devices, before, seconds),
    from,
  );

describe('looking around', () => {
  it('turns left while the stick is held left, as fast as it turns a second, whatever the frames', () => {
    const smooth = playedFor(holding('ArrowLeft'), 60, 1 / 60);
    const choppy = playedFor(holding('ArrowLeft'), 20, 1 / 20);

    expect(smooth.yaw).toBeCloseTo(Look.TURN.yaw);
    expect(choppy.yaw).toBeCloseTo(Look.TURN.yaw);
    expect(smooth.pitch).toBeCloseTo(0);
  });

  it('looks up while the stick is pushed up, never further than straight up', () => {
    const up = playedFor(holding('ArrowUp'), 5, 1 / 10);
    const far = playedFor(holding('ArrowUp'), 100, 1 / 10);

    expect(up.pitch).toBeCloseTo(Look.TURN.pitch / 2);
    expect(far.pitch).toBeCloseTo(Look.PITCH_LIMIT);
  });

  it('stays where it was turned once the stick is let go', () => {
    const turned = playedFor(holding('ArrowLeft'), 10, 1 / 10);
    const still = playedFor(holding(), 10, 1 / 10, turned);

    expect(still.yaw).toBeCloseTo(turned.yaw);
  });
});
