/**
 * What every device a player holds is doing at one moment, in shapes no device has of its own: pads with the buttons and sticks of a standard pad, keys by their place on the keyboard, whatever its layout, and the mouse's buttons, its movement, and its wheel. Sources fill it, such as the Gamepad API or a WebHID driver; controls read it.
 */

/** The buttons of a standard pad, by where they sit: South is A on one pad and Cross on another. */
export type PadButton =
  | 'South'
  | 'East'
  | 'West'
  | 'North'
  | 'LeftBumper'
  | 'RightBumper'
  | 'LeftTrigger'
  | 'RightTrigger'
  | 'Select'
  | 'Start'
  | 'LeftStick'
  | 'RightStick'
  | 'Up'
  | 'Down'
  | 'Left'
  | 'Right'
  | 'Home';

/** The axes of a standard pad's sticks, from -1 to 1, right and down as positive, as the Gamepad API has them. */
export type PadAxis = 'LeftX' | 'LeftY' | 'RightX' | 'RightY';

export const PAD_BUTTONS: ReadonlyArray<PadButton> = [
  'South',
  'East',
  'West',
  'North',
  'LeftBumper',
  'RightBumper',
  'LeftTrigger',
  'RightTrigger',
  'Select',
  'Start',
  'LeftStick',
  'RightStick',
  'Up',
  'Down',
  'Left',
  'Right',
  'Home',
];

export const PAD_AXES: ReadonlyArray<PadAxis> = ['LeftX', 'LeftY', 'RightX', 'RightY'];

/** A pad: how far each button is pressed, from 0 to 1, and where each axis stands. */
export interface Pad {
  readonly buttons: Readonly<Record<PadButton, number>>;
  readonly axes: Readonly<Record<PadAxis, number>>;
}

/** The mouse: its buttons held, by number, and how far it and its wheel moved since the moment before. */
export interface Mouse {
  readonly buttons: ReadonlySet<number>;
  readonly dx: number;
  readonly dy: number;
  readonly wheel: number;
}

/** Every device at one moment. */
export interface State {
  readonly pads: ReadonlyArray<Pad>;
  /** The keys held, by `KeyboardEvent.code`: where a key is, never what it types. */
  readonly keys: ReadonlySet<string>;
  readonly mouse: Mouse;
}

/** A pad with nothing pressed and its sticks at rest. */
export const idlePad: Pad = {
  buttons: {
    South: 0,
    East: 0,
    West: 0,
    North: 0,
    LeftBumper: 0,
    RightBumper: 0,
    LeftTrigger: 0,
    RightTrigger: 0,
    Select: 0,
    Start: 0,
    LeftStick: 0,
    RightStick: 0,
    Up: 0,
    Down: 0,
    Left: 0,
    Right: 0,
    Home: 0,
  },
  axes: { LeftX: 0, LeftY: 0, RightX: 0, RightY: 0 },
};

/** No device doing anything. */
export const idle: State = {
  pads: [],
  keys: new Set(),
  mouse: { buttons: new Set(), dx: 0, dy: 0, wheel: 0 },
};
