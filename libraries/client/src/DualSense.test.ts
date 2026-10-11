import { describe, expect, it } from '@effect/vitest';
import { Option } from 'effect';
import * as Devices from '#src/Devices.ts';
import * as DualSense from '#src/DualSense.ts';

/** A report's bytes, `length` long, with `set` written at their offsets. */
const bytes = (length: number, set: Readonly<Record<number, number>>) => {
  const data = new Uint8Array(length);
  for (const [offset, value] of Object.entries(set)) {
    data[Number(offset)] = value;
  }
  return new DataView(data.buffer);
};

/** Sticks at rest, and the directional pad let go. */
const RESTING = { 0: 128, 1: 128, 2: 128, 3: 128 };

describe('a DualSense', () => {
  it('reads its sticks, triggers, and buttons from a report over USB', () => {
    const report = bytes(63, {
      ...RESTING,
      0: 255,
      3: 0,
      5: 255,
      7: 0x20 | 0x08,
      8: 0x01 | 0x20,
      9: 0x01,
    });

    const pad = DualSense.driver.read({ reportId: 0x01, data: report });

    expect(Option.map(pad, ({ buttons }) => buttons)).toEqual(
      Option.some({
        ...Devices.idlePad.buttons,
        South: 1,
        RightTrigger: 1,
        LeftBumper: 1,
        Start: 1,
        Home: 1,
      }),
    );
    expect(Option.map(pad, ({ axes }) => axes)).toEqual(
      Option.some({ LeftX: 1, LeftY: 0, RightX: 0, RightY: -1 }),
    );
  });

  it('reads its directional pad, diagonals as two directions', () => {
    const pressed = (hat: number) =>
      Option.map(
        DualSense.driver.read({ reportId: 0x01, data: bytes(63, { ...RESTING, 7: hat }) }),
        ({ buttons }) => Devices.PAD_BUTTONS.filter((button) => buttons[button] === 1),
      );

    expect([0, 1, 4, 6, 8].map(pressed)).toEqual(
      [['Up'], ['Up', 'Right'], ['Down'], ['Left'], []].map(Option.some),
    );
  });

  it('reads a full report over Bluetooth, one byte further in, and its short report too', () => {
    const full = DualSense.driver.read({
      reportId: 0x31,
      data: bytes(77, { 1: 255, 2: 128, 3: 128, 4: 128, 8: 0x40 }),
    });
    const short = DualSense.driver.read({
      reportId: 0x01,
      data: bytes(9, { 0: 128, 1: 128, 2: 128, 3: 0, 4: 0x80, 8: 255 }),
    });

    expect(Option.map(full, ({ buttons, axes }) => [buttons.East, axes.LeftX])).toEqual(
      Option.some([1, 1]),
    );
    expect(
      Option.map(short, ({ buttons, axes }) => [buttons.North, buttons.RightTrigger, axes.RightY]),
    ).toEqual(Option.some([1, 1, -1]));
  });

  it('reads nothing of a report it does not know', () => {
    expect(DualSense.driver.read({ reportId: 0x05, data: bytes(40, {}) })).toEqual(Option.none());
  });

  it('is the driver of the DualSense and the DualSense Edge', () => {
    expect(DualSense.driver.devices).toEqual([
      { vendorId: 0x054c, productId: 0x0ce6 },
      { vendorId: 0x054c, productId: 0x0df2 },
    ]);
  });
});
