// @vitest-environment happy-dom
import { describe, expect, it } from '@effect/vitest';
import * as Devices from '#src/Devices.ts';
import * as Navigation from '#src/Navigation.ts';

/** A pad holding `buttons`, and nothing else held. */
const holding = (...buttons: ReadonlyArray<Devices.PadButton>): Devices.Reading => ({
  ...Devices.idle,
  pads: [
    {
      ...Devices.idlePad,
      buttons: {
        ...Devices.idlePad.buttons,
        ...Object.fromEntries(buttons.map((button) => [button, 1])),
      },
    },
  ],
});

/** A container of three buttons, a navigation over it, and the buttons pressed. */
const menu = () => {
  const container = document.createElement('div');
  const pressed: Array<string> = [];
  for (const name of ['first', 'second', 'third']) {
    const button = document.createElement('button');
    button.textContent = name;
    button.addEventListener('click', () => pressed.push(name));
    container.append(button);
  }
  document.body.replaceChildren(container);
  const navigation = Navigation.make(container);
  const focused = () => document.activeElement?.textContent ?? 'nothing';
  return { navigation, pressed, focused };
};

const FRAME = 1 / 60;

describe('navigating with a pad', () => {
  it('moves focus a step at each press of the directional pad, from the first', () => {
    const { navigation, focused } = menu();

    navigation.frame(holding('Down'), FRAME);
    const first = focused();
    navigation.frame(Devices.idle, FRAME);
    navigation.frame(holding('Down'), FRAME);
    const second = focused();
    navigation.frame(Devices.idle, FRAME);
    navigation.frame(holding('Up'), FRAME);

    expect([first, second, focused()]).toEqual(['first', 'second', 'first']);
  });

  it('moves by the left stick too, and goes on moving while a direction is held', () => {
    const { navigation, focused } = menu();
    const leaning: Devices.Reading = {
      ...Devices.idle,
      pads: [{ ...Devices.idlePad, axes: { ...Devices.idlePad.axes, LeftY: 1 } }],
    };

    navigation.frame(leaning, FRAME);
    const once = focused();
    for (let frame = 0; frame < 30; frame += 1) {
      navigation.frame(leaning, FRAME);
    }

    expect(once).toBe('first');
    expect(focused()).toBe('second');
  });

  it('presses what has focus at South, and lets go of focus at East', () => {
    const { navigation, pressed, focused } = menu();

    navigation.frame(holding('Down'), FRAME);
    navigation.frame(Devices.idle, FRAME);
    navigation.frame(holding('South'), FRAME);
    navigation.frame(Devices.idle, FRAME);
    navigation.frame(holding('East'), FRAME);

    expect(pressed).toEqual(['first']);
    expect(focused()).not.toBe('first');
  });

  it('leaves alone what has focus outside its container', () => {
    const { navigation } = menu();
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();

    navigation.frame(holding('South'), FRAME);

    expect(document.activeElement).toBe(outside);
  });
});

/** A pad leaning its left stick `y` up, and nothing else held. */
const leaning = (y: number): Devices.Reading => ({
  ...Devices.idle,
  pads: [{ ...Devices.idlePad, axes: { ...Devices.idlePad.axes, LeftY: -y } }],
});

describe('stepping through a menu a game keeps', () => {
  it('steps each way apart, a step at each press of the directional pad, none more while it is held', () => {
    const stepper = Navigation.stepper({ repeat: false });

    const steps = [
      holding('Down'),
      holding('Down'),
      Devices.idle,
      holding('Right'),
      holding('Up'),
    ].map((devices) => stepper.step(devices, 1));

    expect(steps).toEqual([
      { vertical: 1, horizontal: 0 },
      { vertical: 0, horizontal: 0 },
      { vertical: 0, horizontal: 0 },
      { vertical: 0, horizontal: 1 },
      { vertical: -1, horizontal: 0 },
    ]);
  });

  it('steps at a flick of the stick, and again only once it came back near the middle', () => {
    const stepper = Navigation.stepper({ repeat: false, lean: 0.6, rearm: 0.3 });

    const steps = [0.7, 0.9, 0.4, 0.7, 0.2, 0.7].map(
      (y) => stepper.step(leaning(y), FRAME).vertical,
    );

    expect(steps).toEqual([-1, 0, 0, 0, 0, -1]);
  });

  it('goes on stepping while a direction is held, when it repeats', () => {
    const stepper = Navigation.stepper();

    const steps = [0, 0.3, 0.1, 0.12].map(
      (seconds) => stepper.step(holding('Down'), seconds).vertical,
    );

    expect(steps).toEqual([1, 0, 1, 1]);
  });
});
