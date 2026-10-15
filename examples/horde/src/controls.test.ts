import { describe, expect, it } from '@effect/vitest';
import { Controls, Devices } from '@nitida/client';
import { Option } from 'effect';
import * as HordeControls from '#src/controls.ts';

/** What a survivor does with `devices`, after `before`, with the mouse aiming at `mouseAim`. */
const played = (
  devices: Devices.Reading,
  before: HordeControls.Played = HordeControls.start,
  mouseAim: Option.Option<number> = Option.none(),
) => HordeControls.play(devices, before, mouseAim);

const pad = (pad: {
  readonly buttons?: Partial<Devices.Pad['buttons']>;
  readonly axes?: Partial<Devices.Pad['axes']>;
}): Devices.Reading => ({
  ...Devices.idle,
  pads: [
    {
      buttons: { ...Devices.idlePad.buttons, ...pad.buttons },
      axes: { ...Devices.idlePad.axes, ...pad.axes },
    },
  ],
});

describe('the horde played', () => {
  it('walks by the left stick, up the screen as away from the camera', () => {
    const { stick } = played(pad({ axes: { LeftY: -1 } }));

    expect(stick.x).toBeCloseTo(0);
    expect(stick.z).toBeCloseTo(-1);
  });

  it('aims by the right stick on a pad, and keeps aiming there once it is let go', () => {
    const aiming = played(pad({ axes: { RightX: 1 } }));
    const letGo = played(pad({ buttons: { South: 1 } }), aiming);

    expect(aiming.stick.aim).toBeCloseTo(0);
    expect(played(pad({ axes: { RightY: 1 } })).stick.aim).toBeCloseTo(Math.PI / 2);
    expect(letGo.stick.aim).toBeCloseTo(0);
  });

  it('fires once at a pull of the right trigger, and rises again at Start', () => {
    const pulled = played(pad({ buttons: { RightTrigger: 1 } }));
    const stillPulled = played(pad({ buttons: { RightTrigger: 1 } }), pulled);

    expect(pulled.fired).toBe(true);
    expect(stillPulled.fired).toBe(false);
    expect(played(pad({ buttons: { Start: 1 } })).restarted).toBe(true);
  });

  it('walks by the keys and aims by the mouse, on the keyboard and mouse', () => {
    const { stick, fired } = played(
      {
        ...Devices.idle,
        keys: new Set(['KeyD']),
        mouse: { ...Devices.idle.mouse, buttons: new Set([0]) },
      },
      HordeControls.start,
      Option.some(1),
    );

    expect(stick).toEqual({ x: 1, z: 0, aim: 1 });
    expect(fired).toBe(true);
  });

  it('uses the controls a game binds, read as data', () => {
    expect(HordeControls.bindings.fire).toEqual(Controls.button({ pad: 'RightTrigger', mouse: 0 }));
  });
});
