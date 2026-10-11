import { Option } from 'effect';
import type * as Devices from '#src/Devices.ts';

/**
 * A game's controls, bound to devices as data: each control a name the game gives, such as `move` or `fire`, with how every kind of device works it, the pad's way first. Reading them over what the devices do gives each control's value, a stick as a direction no longer than a full tilt and a button as held or just pressed, and the kind of device the player is using now: the one last used, the pad when both are used at once. What a game makes of the values, its input and its actions, is its own: no device reaches its rules.
 */

/** A stick of a pad, by the side it is on. */
export type PadStick = 'LeftStick' | 'RightStick';

/** A control worked as a stick: a pad's, or four keys. */
export interface Stick {
  readonly _tag: 'Stick';
  readonly pad: Option.Option<PadStick>;
  readonly keys: Option.Option<{
    readonly up: string;
    readonly down: string;
    readonly left: string;
    readonly right: string;
  }>;
}

/** A control worked as a button: a pad's, a key, or a mouse button. */
export interface Button {
  readonly _tag: 'Button';
  readonly pad: Option.Option<Devices.PadButton>;
  readonly key: Option.Option<string>;
  readonly mouse: Option.Option<number>;
}

export type Binding = Stick | Button;

export const stick = (bound: {
  readonly pad?: PadStick;
  readonly keys?: {
    readonly up: string;
    readonly down: string;
    readonly left: string;
    readonly right: string;
  };
}): Stick => ({
  _tag: 'Stick',
  pad: Option.fromNullishOr(bound.pad),
  keys: Option.fromNullishOr(bound.keys),
});

export const button = (bound: {
  readonly pad?: Devices.PadButton;
  readonly key?: string;
  readonly mouse?: number;
}): Button => ({
  _tag: 'Button',
  pad: Option.fromNullishOr(bound.pad),
  key: Option.fromNullishOr(bound.key),
  mouse: Option.fromNullishOr(bound.mouse),
});

/** The kind of device a player uses. */
export type Kind = 'Pad' | 'KeyboardAndMouse';

/** A stick's direction, up and right as positive, never longer than 1. */
export interface Direction {
  readonly x: number;
  readonly y: number;
}

/** A button: whether it is held, and whether it went down just now. */
export interface Press {
  readonly held: boolean;
  readonly pressed: boolean;
}

/** The names of the controls of `Bindings` worked as `Kind`. */
type Named<Bindings, Kind> = {
  [Name in keyof Bindings & string]: Bindings[Name] extends Kind ? Name : never;
}[keyof Bindings & string];

/** The controls as read at one moment. */
export interface Read<Bindings extends Readonly<Record<string, Binding>>> {
  readonly values: {
    readonly stick: (name: Named<Bindings, Stick>) => Direction;
    readonly button: (name: Named<Bindings, Button>) => Press;
  };
  /** The kind of device in use now: the one last used; none before any was. */
  readonly active: Option.Option<Kind>;
  /** Which buttons were held, so the next reading knows which went down since. */
  readonly held: ReadonlySet<string>;
}

/** How far a stick must lean before it counts, so a resting stick's drift moves nothing. */
const DEAD_ZONE = 0.15;
/** How far a pad's button must be pressed to count as held. */
const PRESSED = 0.5;

const still: Direction = { x: 0, y: 0 };

/** `x`, `y` with the dead zone taken out and the rest stretched to fill it, never longer than 1. */
const shaped = (x: number, y: number): Direction => {
  const length = Math.hypot(x, y);
  if (length <= DEAD_ZONE) {
    return still;
  }
  const scale = Math.min((length - DEAD_ZONE) / (1 - DEAD_ZONE), 1) / length;
  return { x: x * scale, y: y * scale };
};

const longer = (a: Direction, b: Direction) =>
  Math.hypot(b.x, b.y) > Math.hypot(a.x, a.y) ? b : a;

const padStick = (pad: Devices.Pad, side: PadStick): Direction =>
  side === 'LeftStick'
    ? shaped(pad.axes.LeftX, -pad.axes.LeftY)
    : shaped(pad.axes.RightX, -pad.axes.RightY);

const keysStick = (
  keys: ReadonlySet<string>,
  bound: {
    readonly up: string;
    readonly down: string;
    readonly left: string;
    readonly right: string;
  },
): Direction => {
  const x = (keys.has(bound.right) ? 1 : 0) - (keys.has(bound.left) ? 1 : 0);
  const y = (keys.has(bound.up) ? 1 : 0) - (keys.has(bound.down) ? 1 : 0);
  const length = Math.hypot(x, y);
  return length === 0 ? still : { x: x / length, y: y / length };
};

/** Whether a pad is being used: a button pressed, or a stick leaning past its dead zone. */
const padUsed = (pad: Devices.Pad) =>
  Object.values(pad.buttons).some((pressed) => pressed > PRESSED) ||
  Math.hypot(pad.axes.LeftX, pad.axes.LeftY) > DEAD_ZONE ||
  Math.hypot(pad.axes.RightX, pad.axes.RightY) > DEAD_ZONE;

const keyboardAndMouseUsed = (devices: Devices.State) =>
  devices.keys.size > 0 ||
  devices.mouse.buttons.size > 0 ||
  devices.mouse.dx !== 0 ||
  devices.mouse.dy !== 0 ||
  devices.mouse.wheel !== 0;

/** The controls before anything was read. */
export const start = <Bindings extends Readonly<Record<string, Binding>>>(
  _bindings: Bindings,
): Read<Bindings> => ({
  values: { stick: () => still, button: () => ({ held: false, pressed: false }) },
  active: Option.none(),
  held: new Set(),
});

/** `bindings` read over `devices`, after `previous`. */
export const read = <Bindings extends Readonly<Record<string, Binding>>>(
  bindings: Bindings,
  devices: Devices.State,
  previous: Read<Bindings>,
): Read<Bindings> => {
  const sticks = new Map<string, Direction>();
  const held = new Set<string>();
  for (const [name, binding] of Object.entries(bindings)) {
    if (binding._tag === 'Stick') {
      const fromPads = Option.match(binding.pad, {
        onNone: () => still,
        onSome: (side) => devices.pads.map((pad) => padStick(pad, side)).reduce(longer, still),
      });
      const fromKeys = Option.match(binding.keys, {
        onNone: () => still,
        onSome: (keys) => keysStick(devices.keys, keys),
      });
      sticks.set(name, longer(fromKeys, fromPads));
    } else {
      const onPad = Option.exists(binding.pad, (bound) =>
        devices.pads.some((pad) => pad.buttons[bound] > PRESSED),
      );
      const onKey = Option.exists(binding.key, (key) => devices.keys.has(key));
      const onMouse = Option.exists(binding.mouse, (bound) => devices.mouse.buttons.has(bound));
      if (onPad || onKey || onMouse) {
        held.add(name);
      }
    }
  }
  const active: Option.Option<Kind> = devices.pads.some(padUsed)
    ? Option.some('Pad')
    : keyboardAndMouseUsed(devices)
      ? Option.some('KeyboardAndMouse')
      : previous.active;
  return {
    values: {
      stick: (name) => sticks.get(name) ?? still,
      button: (name) => ({
        held: held.has(name),
        pressed: held.has(name) && !previous.held.has(name),
      }),
    },
    active,
    held,
  };
};
