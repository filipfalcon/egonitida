import { Option } from 'effect';
import * as Devices from '#src/Devices.ts';
import type * as Haptics from '#src/Haptics.ts';
import type * as Hid from '#src/Hid.ts';

/**
 * Sony's DualSense, and the DualSense Edge, as WebHID reaches them: their reports over USB and over Bluetooth read into a standard pad, Cross as South and Options as Start, and their motors, adaptive triggers, and lightbar written to. The touchpad, the motion sensors, and the mute button wait for something to read them into.
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

/** Which way the directional pad's hat points: 0 up, then round to 7, and 8 for none. */
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

/** The output reports over USB and over Bluetooth, and how long each is after its id where the pad does not say. */
const USB_OUTPUT = { reportId: 0x02, length: 47 };
const BLUETOOTH_OUTPUT = { reportId: 0x31, length: 77 };

/** Where in what both output reports share each thing is written. */
const OUTPUT = {
  flags: 0,
  lightFlags: 1,
  weak: 2,
  strong: 3,
  right: 10,
  left: 21,
  newerFlags: 38,
  lightSetup: 41,
  players: 43,
  light: 44,
};
/** That the motors, as the DualShock 4 had them, and both triggers are written. */
const WRITTEN = 0x01 | 0x02 | 0x04 | 0x08;
/** That the motors are written, as newer firmware reads them. */
const NEWER_WRITTEN = 0x04;
/** That the lightbar is written. */
const LIGHT_WRITTEN = 0x04;
/** That the player lights are written, and that they switch at once rather than fade. */
const PLAYERS_WRITTEN = { flag: 0x10, atOnce: 0x20 };
/** How many player lights the pad has. */
const PLAYER_LIGHTS = 5;
/** That the light the pad shows as it starts is to end, so the lightbar can be lit. */
const LIGHT_SHOW_ENDS = { flag: 0x02, setup: 0x02 };

/** A value kept between 0 and 1. */
const fraction = (value: number) => Math.max(0, Math.min(1, value));

/** A fraction, from 0 to 1, as a byte. */
const byteOf = (value: number) => Math.round(fraction(value) * 255);

/** A point of a trigger's travel, from 0 to 1, as one of the ten zones the pad divides it into. */
const zoneOf = (point: number) => Math.round(fraction(point) * 9);

/** A strength, from 0 to 1, as one of the eight the pad knows. */
const forceOf = (strength: number) => Math.round(fraction(strength) * 7);

/** A trigger effect as the pad reads it, the byte that names the effect and then what it takes: resisting from a zone on, each zone with its force, or a gun's, giving way past the zone it ends at. */
const triggerOf = (trigger: Haptics.Trigger): ReadonlyArray<number> => {
  switch (trigger._tag) {
    case 'Free':
      return [0x05];
    case 'Resisting': {
      const from = zoneOf(trigger.from);
      const force = forceOf(trigger.strength);
      const zones = Array.from({ length: 10 - from }, (_, at) => from + at);
      const reached = zones.reduce((all, zone) => all | (1 << zone), 0);
      const forces = zones.reduce((all, zone) => all | (force << (3 * zone)), 0);
      return [
        0x21,
        reached & 0xff,
        (reached >> 8) & 0xff,
        forces & 0xff,
        (forces >> 8) & 0xff,
        (forces >> 16) & 0xff,
        (forces >>> 24) & 0xff,
      ];
    }
    case 'Clicking': {
      // A gun's trigger begins no sooner than the third zone, and ends after it begins and no later than the ninth.
      const start = Math.max(2, Math.min(7, zoneOf(trigger.from)));
      const end = Math.max(start + 1, Math.min(8, zoneOf(trigger.to)));
      const reached = (1 << start) | (1 << end);
      return [0x25, reached & 0xff, (reached >> 8) & 0xff, forceOf(trigger.strength)];
    }
  }
};

/** What both output reports share, written into `bytes` from `at`, the `sent`th report: the first ends the light the pad starts with. */
const writeShared = (
  bytes: Uint8Array,
  at: number,
  { motors, triggers, light, players }: Hid.Output,
  sent: number,
) => {
  const first = sent === 0;
  bytes[at + OUTPUT.flags] = WRITTEN;
  bytes[at + OUTPUT.newerFlags] = NEWER_WRITTEN | (first ? LIGHT_SHOW_ENDS.flag : 0);
  bytes[at + OUTPUT.lightSetup] = first ? LIGHT_SHOW_ENDS.setup : 0;
  bytes[at + OUTPUT.lightFlags] =
    (Option.isSome(light) ? LIGHT_WRITTEN : 0) |
    (Option.isSome(players) ? PLAYERS_WRITTEN.flag : 0);
  if (Option.isSome(light)) {
    const { red, green, blue } = light.value;
    bytes.set([byteOf(red), byteOf(green), byteOf(blue)], at + OUTPUT.light);
  }
  if (Option.isSome(players)) {
    const lit = Math.max(0, Math.min(PLAYER_LIGHTS, Math.round(players.value)));
    bytes[at + OUTPUT.players] = ((1 << lit) - 1) | PLAYERS_WRITTEN.atOnce;
  }
  bytes[at + OUTPUT.weak] = byteOf(motors.weak);
  bytes[at + OUTPUT.strong] = byteOf(motors.strong);
  bytes.set(triggerOf(triggers.right), at + OUTPUT.right);
  bytes.set(triggerOf(triggers.left), at + OUTPUT.left);
};

/** The CRC-32 table, for the checksum a report over Bluetooth ends with. */
const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) === 0 ? crc >>> 1 : (crc >>> 1) ^ 0xedb88320;
  }
  return crc >>> 0;
});

const crc32 = (bytes: Iterable<number>) => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

/** The output report over Bluetooth: counted in its first byte, tagged in its second, and sealed with a checksum over a seed byte, its id, and what comes before the checksum. */
const bluetooth = (output: Hid.Output, length: number, sent: number): Hid.Report => {
  const bytes = new Uint8Array(length);
  bytes[0] = (sent & 0x0f) << 4;
  bytes[1] = 0x10;
  writeShared(bytes, 2, output, sent);
  const sealed = length - 4;
  const data = new DataView(bytes.buffer);
  data.setUint32(
    sealed,
    crc32([0xa2, BLUETOOTH_OUTPUT.reportId, ...bytes.subarray(0, sealed)]),
    true,
  );
  return { reportId: BLUETOOTH_OUTPUT.reportId, data };
};

const usb = (output: Hid.Output, length: number, sent: number): Hid.Report => {
  const bytes = new Uint8Array(length);
  writeShared(bytes, 0, output, sent);
  return { reportId: USB_OUTPUT.reportId, data: new DataView(bytes.buffer) };
};

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
  // Its calibration, which over Bluetooth is the sign to send full reports from then on.
  features: [0x05],
  // Over Bluetooth where the pad takes its report, else over USB; each as long as the pad says, and never shorter than what is written.
  write: (output, { outputs, sent }) => {
    const takes = (report: { readonly reportId: number; readonly length: number }) =>
      Option.map(
        Option.fromNullishOr(outputs.find(({ reportId }) => reportId === report.reportId)),
        ({ length }) =>
          Math.max(
            report.length,
            Option.getOrElse(length, () => report.length),
          ),
      );
    return Option.match(takes(BLUETOOTH_OUTPUT), {
      onSome: (length) => Option.some(bluetooth(output, length, sent)),
      onNone: () => Option.map(takes(USB_OUTPUT), (length) => usb(output, length, sent)),
    });
  },
};
