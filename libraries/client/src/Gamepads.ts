import * as Devices from '#src/Devices.ts';

/**
 * Pads as the Gamepad API reaches them: a standard pad read by the standard layout, a DualSense or an Xbox pad alike, and any other device, a wheel or a flight stick, through a layout given as data that says where its buttons and axes are. A device of no layout known is left out rather than guessed at.
 */

/** A gamepad, as much of one as is read: what `navigator.getGamepads()` gives. */
export interface Gamepad {
  readonly id: string;
  readonly mapping: string;
  readonly connected: boolean;
  readonly buttons: ReadonlyArray<{ readonly value: number }>;
  readonly axes: ReadonlyArray<number>;
}

/** Where a device of no standard layout has its buttons and axes, by index; it is the layout of every device whose id holds `id`. */
export interface Layout {
  readonly id: string;
  readonly buttons: Partial<Readonly<Record<Devices.PadButton, number>>>;
  readonly axes: Partial<
    Readonly<Record<Devices.PadAxis, { readonly index: number; readonly inverted?: boolean }>>
  >;
}

/** The standard layout: buttons and axes in the order the Gamepad API's standard mapping gives them. */
const standard: Layout = {
  id: '',
  buttons: Object.fromEntries(Devices.PAD_BUTTONS.map((button, index) => [button, index])),
  axes: Object.fromEntries(Devices.PAD_AXES.map((axis, index) => [axis, { index }])),
};

const padOf = (gamepad: Gamepad, layout: Layout): Devices.Pad => {
  const buttons = { ...Devices.idlePad.buttons };
  for (const button of Devices.PAD_BUTTONS) {
    const index = layout.buttons[button];
    buttons[button] = index === undefined ? 0 : (gamepad.buttons[index]?.value ?? 0);
  }
  const axes = { ...Devices.idlePad.axes };
  for (const axis of Devices.PAD_AXES) {
    const at = layout.axes[axis];
    const value = at === undefined ? 0 : (gamepad.axes[at.index] ?? 0);
    axes[axis] = at?.inverted === true ? -value : value;
  }
  return { buttons, axes };
};

/** The pads among `gamepads`, read by the standard layout or one of `layouts`; empty slots, pads gone, and pads of no layout known are left out. */
export const read = (
  gamepads: ReadonlyArray<Gamepad | null>,
  layouts: ReadonlyArray<Layout> = [],
): ReadonlyArray<Devices.Pad> =>
  gamepads.flatMap((gamepad) => {
    if (gamepad === null || !gamepad.connected) {
      return [];
    }
    const layout =
      gamepad.mapping === 'standard' ? standard : layouts.find(({ id }) => gamepad.id.includes(id));
    return layout === undefined ? [] : [padOf(gamepad, layout)];
  });

/** The pads connected now, read off the browser; none where it has no Gamepad API. */
export const poll = (layouts: ReadonlyArray<Layout> = []): ReadonlyArray<Devices.Pad> =>
  typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function'
    ? []
    : read(navigator.getGamepads(), layouts);
