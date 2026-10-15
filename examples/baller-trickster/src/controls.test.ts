import { describe, expect, it } from '@effect/vitest';
import { Controls, Devices } from '@lightocean/client';
import * as BallerControls from '#src/controls.ts';

/** The controls as read over `devices`, after nothing. */
const read = (devices: Devices.Reading) =>
  Controls.read(BallerControls.bindings, devices, Controls.start(BallerControls.bindings));

/** A pad holding `pad`, and nothing else held. */
const onPad = (pad: Partial<Devices.Pad>): Devices.Reading => ({
  ...Devices.idle,
  pads: [{ ...Devices.idlePad, ...pad }],
});

describe('the baller’s controls', () => {
  it('place each foot by its stick and lift it by its trigger', () => {
    const feet = BallerControls.feetOf(
      read(
        onPad({
          axes: { ...Devices.idlePad.axes, LeftX: 1, RightY: -1 },
          buttons: { ...Devices.idlePad.buttons, RightTrigger: 0.5 },
        }),
      ),
    );

    expect(feet.left.x).toBeCloseTo(1, 6);
    expect(feet.right.y).toBeCloseTo(1, 6);
    expect(feet.right.lift).toBeCloseTo(0.5, 6);
    expect(feet.left.lift).toBe(0);
  });

  it('place them by the keys as well, and put the ball back at a press of R', () => {
    const controls = read({ ...Devices.idle, keys: new Set(['KeyW', 'KeyQ', 'KeyR']) });

    expect(BallerControls.feetOf(controls).left).toEqual({ x: 0, y: 1, lift: 1 });
    expect(BallerControls.replaced(controls)).toBe(true);
  });
});
