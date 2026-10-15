import { describe, expect, it } from '@effect/vitest';
import { Controls, Devices } from '@nitida/client';
import * as Baller from '#src/baller.ts';
import * as Camera from '#src/camera.ts';
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
      Baller.idle,
    );

    expect(feet.left.x).toBeCloseTo(1, 6);
    expect(feet.right.y).toBeCloseTo(1, 6);
    expect(feet.right.lift).toBeCloseTo(0.5, 6);
    expect(feet.left.lift).toBe(0);
  });

  it('place them by the keys as well, and put the ball back at a press of R', () => {
    const controls = read({ ...Devices.idle, keys: new Set(['KeyW', 'KeyQ', 'KeyR']) });

    expect(BallerControls.feetOf(controls, Baller.idle).left).toEqual({ x: 0, y: 1, lift: 1 });
    expect(BallerControls.replaced(controls)).toBe(true);
  });

  it('turn the camera by a stick held in, its foot holding where it was', () => {
    const held = { x: 0.3, y: 0.5, lift: 0 };
    const controls = read(
      onPad({
        axes: { ...Devices.idlePad.axes, LeftX: 1 },
        buttons: { ...Devices.idlePad.buttons, LeftStick: 1 },
      }),
    );

    const feet = BallerControls.feetOf(controls, { ...Baller.idle, left: held });
    const turned = Camera.orbit(controls, Camera.start, 0.5);

    expect(feet.left).toEqual(held);
    expect(turned.around).toBeCloseTo(Camera.TURN.around * 0.5, 6);
    expect(turned.up).toBeCloseTo(Camera.start.up, 6);
  });

  it('never turn the camera under the ground or over her head', () => {
    const controls = read(
      onPad({
        axes: { ...Devices.idlePad.axes, RightY: 1 },
        buttons: { ...Devices.idlePad.buttons, RightStick: 1 },
      }),
    );

    expect(Camera.orbit(controls, Camera.start, 10).up).toBe(Camera.LOWEST);
  });
});
