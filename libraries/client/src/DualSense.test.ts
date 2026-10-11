import { describe, expect, it } from '@effect/vitest';
import { Option } from 'effect';
import * as Devices from '#src/Devices.ts';
import * as DualSense from '#src/DualSense.ts';
import * as Haptics from '#src/Haptics.ts';
import * as Hid from '#src/Hid.ts';

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

  it('writes its motors and triggers in a report over USB, as long as the pad says it is', () => {
    const report = DualSense.driver.write(
      {
        motors: { strong: 1, weak: 0.5 },
        triggers: {
          left: Haptics.free,
          right: { _tag: 'Clicking', from: 0.2, to: 0.5, strength: 1 },
        },
        light: Option.none(),
      },
      { outputs: [{ reportId: 0x02, length: Option.none() }], sent: 1 },
    );
    const declared = DualSense.driver.write(Hid.still, {
      outputs: [{ reportId: 0x02, length: Option.some(63) }],
      sent: 0,
    });

    const at = (offsets: ReadonlyArray<number>) =>
      Option.map(report, ({ data }) => offsets.map((offset) => data.getUint8(offset)));
    expect(Option.map(report, ({ reportId, data }) => [reportId, data.byteLength])).toEqual(
      Option.some([0x02, 47]),
    );
    expect(Option.map(declared, ({ data }) => data.byteLength)).toEqual(Option.some(63));
    // Both kinds of rumble flagged, as older firmware and newer read them.
    expect(at([0, 38, 2, 3])).toEqual(Option.some([0x0f, 0x04, 128, 255]));
    // A gun's trigger, giving way from the third to the sixth of its ten zones, at its strongest; the other free.
    expect(at([10, 11, 12, 13, 21])).toEqual(Option.some([0x25, 0x24, 0x00, 7, 0x05]));
  });

  it('writes a trigger that resists from a point of its travel on, zone by zone', () => {
    const report = DualSense.driver.write(
      {
        ...Hid.still,
        triggers: { left: Haptics.free, right: { _tag: 'Resisting', from: 0.7, strength: 1 } },
      },
      { outputs: [{ reportId: 0x02, length: Option.none() }], sent: 0 },
    );

    expect(
      Option.map(report, ({ data }) => [...new Uint8Array(data.buffer).subarray(10, 17)]),
    ).toEqual(Option.some([0x21, 0xc0, 0x03, 0x00, 0x00, 0xfc, 0x3f]));
  });

  it('writes the same over Bluetooth, two bytes further in, counted and sealed with its checksum', () => {
    const report = DualSense.driver.write(
      { ...Hid.still, motors: { strong: 0, weak: 1 } },
      { outputs: [{ reportId: 0x31, length: Option.none() }], sent: 3 },
    );

    const data = Option.map(report, ({ data }) => new Uint8Array(data.buffer));
    expect(Option.map(report, ({ reportId, data }) => [reportId, data.byteLength])).toEqual(
      Option.some([0x31, 77]),
    );
    expect(Option.map(data, (bytes) => [...bytes.subarray(0, 5)])).toEqual(
      Option.some([0x30, 0x10, 0x0f, 0, 255]),
    );
    // CRC-32 of 0xa2, the report's id, and its first 73 bytes, as Python's `zlib.crc32` has it.
    expect(Option.map(report, ({ data }) => data.getUint32(73, true))).toEqual(
      Option.some(0x01080f5d),
    );
  });

  it('lights its lightbar, the first report ending the light it starts with, and leaves it be unless asked', () => {
    const usb = [{ reportId: 0x02, length: Option.none() }];
    const bytesOf = (report: Option.Option<Hid.Report>, offsets: ReadonlyArray<number>) =>
      Option.map(report, ({ data }) => offsets.map((offset) => data.getUint8(offset)));
    const light = { ...Hid.still, light: Option.some({ red: 1, green: 0.5, blue: 0 }) };

    const first = DualSense.driver.write(light, { outputs: usb, sent: 0 });
    const later = DualSense.driver.write(light, { outputs: usb, sent: 1 });
    const unlit = DualSense.driver.write(Hid.still, { outputs: usb, sent: 1 });

    expect(bytesOf(first, [1, 38, 41, 44, 45, 46])).toEqual(
      Option.some([0x04, 0x04 | 0x02, 0x02, 255, 128, 0]),
    );
    expect(bytesOf(later, [1, 38, 41])).toEqual(Option.some([0x04, 0x04, 0]));
    expect(bytesOf(unlit, [1, 44])).toEqual(Option.some([0, 0]));
  });

  it('asks for its calibration once it opens, which over Bluetooth starts its full reports', () => {
    expect(DualSense.driver.features).toEqual([0x05]);
  });

  it('is the driver of the DualSense and the DualSense Edge', () => {
    expect(DualSense.driver.devices).toEqual([
      { vendorId: 0x054c, productId: 0x0ce6 },
      { vendorId: 0x054c, productId: 0x0df2 },
    ]);
  });
});
