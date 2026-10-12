import { Option } from 'effect';
import type * as Devices from '#src/Devices.ts';

/**
 * A game's controls, bound to devices as data: each control a name the game gives, such as `move` or `fire`, with how every kind of device works it, the pad's way first. Reading them over what the devices do gives each control's value, a stick as a direction no longer than a full tilt and a button as held or just pressed, and the kind of device the player is using now: the one last used, the pad when both are used at once. What a game makes of the values, its demands and its actions, is its own: no device reaches its rules.
 */

/** A stick of a pad, by the side it is on. */
export type PadStick = 'LeftStick' | 'RightStick';

/** Four keys that work a stick. */
export interface Keys {
  readonly up: string;
  readonly down: string;
  readonly left: string;
  readonly right: string;
}

/** How far a pad's stick must lean before it counts, so a resting stick's drift moves nothing, and how far it leans at most, as far as a worn stick reaches: between them it is stretched from nothing to a full tilt. */
export interface DeadZone {
  readonly inner: number;
  readonly outer: number;
}

/** A control worked as a stick: by a pad's sticks, or by sets of four keys, any of them; a pad's within its dead zone. */
export interface Stick {
  readonly _tag: 'Stick';
  readonly pad: ReadonlyArray<PadStick>;
  readonly keys: ReadonlyArray<Keys>;
  readonly deadZone: DeadZone;
}

/** A control worked as a button: by a pad's buttons, keys, or mouse buttons, any of them; a pad's held once pressed as far as `heldAt`. */
export interface Button {
  readonly _tag: 'Button';
  readonly pad: ReadonlyArray<Devices.PadButton>;
  readonly key: ReadonlyArray<string>;
  readonly mouse: ReadonlyArray<number>;
  readonly heldAt: number;
}

export type Binding = Stick | Button;

/** One of something, or several. */
type Some<A> = A | ReadonlyArray<A>;

const all = <A>(
  some: Some<A> | undefined,
  one: (value: Some<A>) => value is A,
): ReadonlyArray<A> => (some === undefined ? [] : one(some) ? [some] : some);

const isString = (value: Some<string>): value is string => typeof value === 'string';
const isNumber = (value: Some<number>): value is number => typeof value === 'number';
const isKeys = (value: Some<Keys>): value is Keys => 'up' in value;

/** A control worked as a stick, by `pad`'s sticks and `keys`; a pad's within `deadZone`, a little drift to a full tilt unless given. */
export const stick = (bound: {
  readonly pad?: Some<PadStick>;
  readonly keys?: Some<Keys>;
  readonly deadZone?: DeadZone;
}): Stick => ({
  _tag: 'Stick',
  pad: all(bound.pad, (value): value is PadStick => typeof value === 'string'),
  keys: all(bound.keys, isKeys),
  deadZone: bound.deadZone ?? DEAD_ZONE,
});

/** A control worked as a button, by `pad`'s buttons, a `key`, or a `mouse` button; a pad's held once pressed as far as `heldAt`, halfway unless given, as a trigger may be wanted held sooner. */
export const button = (bound: {
  readonly pad?: Some<Devices.PadButton>;
  readonly key?: Some<string>;
  readonly mouse?: Some<number>;
  readonly heldAt?: number;
}): Button => ({
  _tag: 'Button',
  pad: all(bound.pad, (value): value is Devices.PadButton => typeof value === 'string'),
  key: all(bound.key, isString),
  mouse: all(bound.mouse, isNumber),
  heldAt: bound.heldAt ?? PRESSED,
});

/** The kind of device a player uses. */
export type Kind = 'Pad' | 'KeyboardAndMouse';

/** A stick's direction, up and right as positive, never longer than 1. */
export interface Direction {
  readonly x: number;
  readonly y: number;
}

/** A button: whether it is held, whether it went down just now, and how far it is pressed, from 0 to 1, a key or a mouse button all the way. */
export interface Press {
  readonly held: boolean;
  readonly pressed: boolean;
  readonly value: number;
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

/** How far a stick must lean before it counts, so a resting stick's drift moves nothing; a full tilt counts all of it. */
const DEAD_ZONE: DeadZone = { inner: 0.15, outer: 1 };
/** How far a pad's button must be pressed to count as held, unless its binding says. */
const PRESSED = 0.5;

const still: Direction = { x: 0, y: 0 };

/** `x`, `y` with `zone`'s inner part taken out and the rest stretched to its outer edge, never longer than 1. */
const shaped = (x: number, y: number, zone: DeadZone): Direction => {
  const length = Math.hypot(x, y);
  if (length <= zone.inner) {
    return still;
  }
  const scale = Math.min((length - zone.inner) / (zone.outer - zone.inner), 1) / length;
  return { x: x * scale, y: y * scale };
};

const longer = (a: Direction, b: Direction) =>
  Math.hypot(b.x, b.y) > Math.hypot(a.x, a.y) ? b : a;

const padStick = (pad: Devices.Pad, side: PadStick, zone: DeadZone): Direction =>
  side === 'LeftStick'
    ? shaped(pad.axes.LeftX, -pad.axes.LeftY, zone)
    : shaped(pad.axes.RightX, -pad.axes.RightY, zone);

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
  Math.hypot(pad.axes.LeftX, pad.axes.LeftY) > DEAD_ZONE.inner ||
  Math.hypot(pad.axes.RightX, pad.axes.RightY) > DEAD_ZONE.inner;

const keyboardAndMouseUsed = (devices: Devices.Reading) =>
  devices.keys.size > 0 ||
  devices.mouse.buttons.size > 0 ||
  devices.mouse.dx !== 0 ||
  devices.mouse.dy !== 0 ||
  devices.mouse.wheel !== 0;

/** The controls before anything was read. */
export const start = <Bindings extends Readonly<Record<string, Binding>>>(
  _bindings: Bindings,
): Read<Bindings> => ({
  values: { stick: () => still, button: () => ({ held: false, pressed: false, value: 0 }) },
  active: Option.none(),
  held: new Set(),
});

/** `bindings` read over `devices`, after `previous`. */
export const read = <Bindings extends Readonly<Record<string, Binding>>>(
  bindings: Bindings,
  devices: Devices.Reading,
  previous: Read<Bindings>,
): Read<Bindings> => {
  const sticks = new Map<string, Direction>();
  const held = new Set<string>();
  const pressedAs = new Map<string, number>();
  for (const [name, binding] of Object.entries(bindings)) {
    if (binding._tag === 'Stick') {
      const fromPads = binding.pad
        .flatMap((side) => devices.pads.map((pad) => padStick(pad, side, binding.deadZone)))
        .reduce(longer, still);
      const fromKeys = binding.keys
        .map((keys) => keysStick(devices.keys, keys))
        .reduce(longer, still);
      sticks.set(name, longer(fromKeys, fromPads));
    } else {
      const onPad = binding.pad
        .flatMap((bound) => devices.pads.map((pad) => pad.buttons[bound]))
        .reduce((most, value) => Math.max(most, value), 0);
      const onKey = binding.key.some((key) => devices.keys.has(key));
      const onMouse = binding.mouse.some((bound) => devices.mouse.buttons.has(bound));
      const value = onKey || onMouse ? 1 : onPad;
      pressedAs.set(name, value);
      if (onKey || onMouse || onPad >= binding.heldAt) {
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
        value: pressedAs.get(name) ?? 0,
      }),
    },
    active,
    held,
  };
};

/** Whether a trigger is ready to fire: let back far enough since it last fired. */
export interface Latch {
  readonly armed: boolean;
}

/** A trigger that has not fired yet. */
export const armed: Latch = { armed: true };

/** Whether a trigger pressed as far as `value` fires now, after `latch`: pulled past `breakAt` while armed, it fires once, and is armed again only once let back past `resetAt`, as a gun's trigger breaks and resets, so holding it fires nothing more and a trembling finger does not fire twice. */
export const latched = (
  latch: Latch,
  value: number,
  at: { readonly breakAt: number; readonly resetAt: number },
): { readonly fired: boolean; readonly latch: Latch } =>
  latch.armed && value >= at.breakAt
    ? { fired: true, latch: { armed: false } }
    : { fired: false, latch: !latch.armed && value <= at.resetAt ? armed : latch };
