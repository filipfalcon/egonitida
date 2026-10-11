import { Option } from 'effect';
import * as Devices from '#src/Devices.ts';
import type * as Hid from '#src/Hid.ts';

/**
 * Sony's DualSense, and the DualSense Edge, as WebHID reaches them: their reports over USB and over Bluetooth read into a standard pad, Cross as South and Options as Start. The touchpad, the motion sensors, and the mute button wait for something to read them into.
 */

/** Where in a report the sticks, the triggers, and the buttons begin: one byte further in over Bluetooth's full report, and laid out apart in its short one. */
interface Layout {
  readonly sticks: number;
  readonly triggers: number;
  readonly buttons: number;
}

/** The report over USB, and the full one over Bluetooth, a byte further in. */
const FULL: Layout = { sticks: 0, triggers: 4, buttons: 7 };
const BLUETOOTH: Layout = { sticks: 1, triggers: 5, buttons: 8 };
/** Bluetooth's short report, before the pad is asked for its full one. */
const SHORT: Layout = { sticks: 0, triggers: 7, buttons: 4 };

/** A stick's byte, from 0 to 255 with 128 at rest, as from -1 to 1. */
const axis = (byte: number) => Math.max(-1, Math.min(1, (byte - 128) / 127));

/** Which directions the directional pad's hat holds: 0 up, then round to 7, and 8 for none. */
const HAT: ReadonlyArray<ReadonlyArray<Devices.PadButton>> = [
  ['Up'],
  ['Up', 'Right'],
  ['Right'],
  ['Down', 'Right'],
  ['Down'],
  ['Down', 'Left'],
  ['Left'],
  ['Up', 'Left'],
];

const padOf = (data: DataView, layout: Layout): Devices.Pad => {
  const byte = (offset: number) => data.getUint8(offset);
  const face = byte(layout.buttons);
  const shoulders = byte(layout.buttons + 1);
  const system = byte(layout.buttons + 2);
  const bit = (value: number, mask: number) => ((value & mask) === 0 ? 0 : 1);
  const held = new Set(HAT[face & 0x0f] ?? []);
  const direction = (button: Devices.PadButton) => (held.has(button) ? 1 : 0);
  return {
    buttons: {
      South: bit(face, 0x20),
      East: bit(face, 0x40),
      West: bit(face, 0x10),
      North: bit(face, 0x80),
      LeftBumper: bit(shoulders, 0x01),
      RightBumper: bit(shoulders, 0x02),
      LeftTrigger: byte(layout.triggers) / 255,
      RightTrigger: byte(layout.triggers + 1) / 255,
      Select: bit(shoulders, 0x10),
      Start: bit(shoulders, 0x20),
      LeftStick: bit(shoulders, 0x40),
      RightStick: bit(shoulders, 0x80),
      Up: direction('Up'),
      Down: direction('Down'),
      Left: direction('Left'),
      Right: direction('Right'),
      Home: bit(system, 0x01),
    },
    axes: {
      LeftX: axis(byte(layout.sticks)),
      LeftY: axis(byte(layout.sticks + 1)),
      RightX: axis(byte(layout.sticks + 2)),
      RightY: axis(byte(layout.sticks + 3)),
    },
  };
};

/** How long Bluetooth's short report is; the one over USB is longer. */
const SHORT_LENGTH = 9;

export const driver: Hid.Driver = {
  name: 'DualSense',
  devices: [
    { vendorId: 0x054c, productId: 0x0ce6 },
    { vendorId: 0x054c, productId: 0x0df2 },
  ],
  read: ({ reportId, data }) => {
    if (reportId === 0x31 && data.byteLength >= BLUETOOTH.buttons + 3) {
      return Option.some(padOf(data, BLUETOOTH));
    }
    if (reportId === 0x01 && data.byteLength >= FULL.buttons + 3) {
      return Option.some(padOf(data, data.byteLength <= SHORT_LENGTH ? SHORT : FULL));
    }
    if (reportId === 0x01 && data.byteLength >= SHORT.triggers + 2) {
      return Option.some(padOf(data, SHORT));
    }
    return Option.none();
  },
};
