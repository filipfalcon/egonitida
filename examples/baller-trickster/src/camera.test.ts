import { describe, expect, it } from '@effect/vitest';
import { Controls, Devices } from '@egonitida/client';
import * as Camera from '#src/camera.ts';
import * as BallerControls from '#src/controls.ts';

/** The controls as read over the keys `keys`, held after nothing. */
const holding = (...keys: ReadonlyArray<string>) =>
  Controls.read(
    BallerControls.bindings,
    { ...Devices.idle, keys: new Set(keys) },
    Controls.start(BallerControls.bindings),
  );

/** A camera floating at head height, looking along +z, through a lens as wide as a camera's is to begin with. */
const floating: Camera.Floating = { at: { x: 0, y: 1.6, z: 0 }, heading: 0, pitch: 0, lens: 50 };

describe('the camera floating as a photograph is taken', () => {
  it('floats ahead where it looks and aside, at the left stick or WASD', () => {
    const ahead = Camera.float(holding('KeyW'), floating, 1);
    const aside = Camera.float(holding('KeyD'), floating, 1);

    expect(ahead.at.z).toBeCloseTo(Camera.FLOATING.along, 6);
    expect(ahead.at.x).toBeCloseTo(0, 6);
    // Looking along +z, its right lies toward -x.
    expect(aside.at.x).toBeCloseTo(-Camera.FLOATING.along, 6);
  });

  it('rises at U or the right trigger, sinks at Q or the left, never under the ground', () => {
    const risen = Camera.float(holding('KeyU'), floating, 1);
    const sunk = Camera.float(holding('KeyQ'), floating, 10);

    expect(risen.at.y).toBeCloseTo(1.6 + Camera.FLOATING.up, 6);
    expect(sunk.at.y).toBeCloseTo(Camera.LOWEST_FLOAT, 6);
  });

  it('turns where it looks at the right stick or IJKL, never straight up or down', () => {
    const right = Camera.float(holding('KeyL'), floating, 0.5);
    const up = Camera.float(holding('KeyI'), floating, 100);

    expect(right.heading).toBeLessThan(0);
    expect(up.pitch).toBeCloseTo(Camera.STEEPEST, 6);
  });

  it('zooms in at + or the right bumper, its lens narrower, and out at -, within a lens’s reach', () => {
    const inward = Camera.float(holding('Equal'), floating, 1);
    const outward = Camera.float(holding('Minus'), floating, 100);

    expect(inward.lens).toBeLessThan(floating.lens);
    expect(outward.lens).toBeCloseTo(Camera.WIDEST, 6);
  });

  it('starts floating where a camera stands, looking where it looks', () => {
    const started = Camera.floatingFrom(
      { x: 1, y: 2, z: 3 },
      { x: 0, y: -Math.SQRT1_2, z: Math.SQRT1_2 },
      40,
    );

    expect(started.at).toEqual({ x: 1, y: 2, z: 3 });
    expect(started.heading).toBeCloseTo(0, 6);
    expect(started.pitch).toBeCloseTo(-Math.PI / 4, 6);
    expect(started.lens).toBe(40);
    const looking = Camera.lookingOf(started);
    expect(looking.y).toBeCloseTo(-Math.SQRT1_2, 6);
    expect(looking.z).toBeCloseTo(Math.SQRT1_2, 6);
  });
});
