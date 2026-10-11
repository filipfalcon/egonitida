import { describe, expect, it } from '@effect/vitest';
import { Option } from 'effect';
import * as Controls from '#src/Controls.ts';
import * as Devices from '#src/Devices.ts';

/** A survivor's controls: walking and aiming as sticks, firing and restarting as buttons. */
const bindings = {
  move: Controls.stick({
    pad: 'LeftStick',
    keys: { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' },
  }),
  aim: Controls.stick({ pad: 'RightStick' }),
  fire: Controls.button({ pad: 'RightTrigger', mouse: 0 }),
  restart: Controls.button({ pad: 'Start', key: 'KeyR' }),
};

/** Nothing held on any device. */
const idle = Devices.idle;

/** A pad holding `pad`, and nothing else held. */
const onPad = (pad: Partial<Devices.Pad>): Devices.State => ({
  ...idle,
  pads: [{ ...Devices.idlePad, ...pad }],
});

const read = (devices: Devices.State, previous = Controls.start(bindings)) =>
  Controls.read(bindings, devices, previous);

describe('controls', () => {
  it('read a stick from a pad, up as positive, and ignore drift within the dead zone', () => {
    const tilted = read(onPad({ axes: { ...Devices.idlePad.axes, LeftX: 0.5, LeftY: -1 } }));
    const drifting = read(onPad({ axes: { ...Devices.idlePad.axes, LeftX: 0.05 } }));

    expect(tilted.values.stick('move').x).toBeCloseTo(0.5 / Math.hypot(0.5, 1));
    expect(tilted.values.stick('move').y).toBeCloseTo(1 / Math.hypot(0.5, 1));
    expect(drifting.values.stick('move')).toEqual({ x: 0, y: 0 });
  });

  it('read a stick from keys, never longer than a full tilt', () => {
    const held = read({ ...idle, keys: new Set(['KeyW', 'KeyD']) });

    expect(held.values.stick('move').x).toBeCloseTo(Math.SQRT1_2);
    expect(held.values.stick('move').y).toBeCloseTo(Math.SQRT1_2);
  });

  it('read a button as held, and as pressed only in the frame it went down', () => {
    const first = read(onPad({ buttons: { ...Devices.idlePad.buttons, RightTrigger: 1 } }));
    const second = read(onPad({ buttons: { ...Devices.idlePad.buttons, RightTrigger: 1 } }), first);
    const clicked = read({ ...idle, mouse: { ...idle.mouse, buttons: new Set([0]) } });

    expect(first.values.button('fire')).toEqual({ held: true, pressed: true, value: 1 });
    expect(second.values.button('fire')).toEqual({ held: true, pressed: false, value: 1 });
    expect(clicked.values.button('fire')).toEqual({ held: true, pressed: true, value: 1 });
    expect(first.values.button('restart')).toEqual({ held: false, pressed: false, value: 0 });
  });

  it('answer to the device last used, the pad when both are used at once', () => {
    const keyboard = read({ ...idle, keys: new Set(['KeyR']) });
    const stillKeyboard = read(idle, keyboard);
    const both = read(
      { ...onPad({ buttons: { ...Devices.idlePad.buttons, South: 1 } }), keys: new Set(['KeyW']) },
      stillKeyboard,
    );
    const drift = read(onPad({ axes: { ...Devices.idlePad.axes, RightX: 0.05 } }), keyboard);

    expect(keyboard.active).toEqual(Option.some('KeyboardAndMouse'));
    expect(stillKeyboard.active).toEqual(Option.some('KeyboardAndMouse'));
    expect(both.active).toEqual(Option.some('Pad'));
    expect(drift.active).toEqual(Option.some('KeyboardAndMouse'));
    expect(read(idle).active).toEqual(Option.none());
  });

  it('read a control bound to several keys, buttons, and pads alike', () => {
    const many = {
      move: Controls.stick({
        keys: [
          { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' },
          { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' },
        ],
      }),
      fire: Controls.button({
        pad: ['RightTrigger', 'South'],
        key: ['Space', 'Enter'],
        mouse: [0, 2],
      }),
    };
    const reading = (devices: Devices.State) => Controls.read(many, devices, Controls.start(many));

    expect(reading({ ...idle, keys: new Set(['ArrowUp']) }).values.stick('move')).toEqual({
      x: 0,
      y: 1,
    });
    expect(reading({ ...idle, keys: new Set(['Enter']) }).values.button('fire').held).toBe(true);
    expect(
      reading({ ...idle, mouse: { ...idle.mouse, buttons: new Set([2]) } }).values.button('fire')
        .held,
    ).toBe(true);
    expect(
      reading(onPad({ buttons: { ...Devices.idlePad.buttons, South: 1 } })).values.button('fire')
        .held,
    ).toBe(true);
  });

  it('read how far a pad button is pressed, held from where its binding says', () => {
    const triggers = {
      fire: Controls.button({ pad: 'RightTrigger', mouse: 0 }),
      aim: Controls.button({ pad: 'LeftTrigger', heldAt: 0.3 }),
    };
    const halfway = Controls.read(
      triggers,
      onPad({ buttons: { ...Devices.idlePad.buttons, RightTrigger: 0.4, LeftTrigger: 0.4 } }),
      Controls.start(triggers),
    );

    expect(halfway.values.button('fire')).toEqual({ held: false, pressed: false, value: 0.4 });
    expect(halfway.values.button('aim')).toEqual({ held: true, pressed: true, value: 0.4 });
  });

  it('take a dead zone of a stick from its binding, stretching the rest to its outer edge', () => {
    const shaped = {
      look: Controls.stick({ pad: 'RightStick', deadZone: { inner: 0.2, outer: 0.8 } }),
    };
    const lookAt = (x: number) =>
      Controls.read(
        shaped,
        onPad({ axes: { ...Devices.idlePad.axes, RightX: x } }),
        Controls.start(shaped),
      ).values.stick('look').x;

    expect(lookAt(0.2)).toBe(0);
    expect(lookAt(0.5)).toBeCloseTo(0.5);
    expect(lookAt(0.8)).toBeCloseTo(1);
    expect(lookAt(1)).toBeCloseTo(1);
  });
});

describe('a trigger latched', () => {
  it('fires once it is pulled past where it breaks, and again only once let back past where it resets', () => {
    const at = { breakAt: 0.68, resetAt: 0.35 };
    const pulls = [0, 0.5, 0.7, 0.9, 0.5, 0.7, 0.3, 0.8];

    const fired = pulls.reduce(
      ({ latch, shots }, value) => {
        const next = Controls.latched(latch, value, at);
        return { latch: next.latch, shots: [...shots, next.fired] };
      },
      { latch: Controls.armed, shots: new Array<boolean>() },
    ).shots;

    expect(fired).toEqual([false, false, true, false, false, false, false, true]);
  });
});
