import { Effect, Option } from 'effect';
import * as Devices from '#src/Devices.ts';
import type * as Haptics from '#src/Haptics.ts';

/**
 * Pads as the Gamepad API reaches them: a standard pad read by the standard layout, a DualSense or an Xbox pad alike, and any other device, a wheel or a flight stick, through a layout given as data that says where its buttons and axes are. A device of no layout known is left out rather than guessed at. A pad with motors rumbles; its triggers are the Gamepad API's to leave alone, as it has nothing that makes them push back.
 */

/** A gamepad, as much of one as is read: what `navigator.getGamepads()` gives. */
export interface Gamepad {
  readonly id: string;
  readonly mapping: string;
  readonly connected: boolean;
  readonly buttons: ReadonlyArray<{ readonly value: number }>;
  readonly axes: ReadonlyArray<number>;
  /** Its motors, where it has them and the browser reaches them. */
  readonly vibrationActuator?: Pick<GamepadHapticActuator, 'playEffect'> | null | undefined;
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

/** The vendor and product a gamepad's id names, as Chrome writes them (`Vendor: 054c Product: 0ce6`) or Firefox does (`054c-0ce6-…`). */
const modelOf = (
  id: string,
): Option.Option<{ readonly vendorId: number; readonly productId: number }> => {
  const found =
    /Vendor: ([0-9a-f]{4}) Product: ([0-9a-f]{4})/i.exec(id) ??
    /^([0-9a-f]{4})-([0-9a-f]{4})-/i.exec(id);
  return found === null || found[1] === undefined || found[2] === undefined
    ? Option.none()
    : Option.some({
        vendorId: Number.parseInt(found[1], 16),
        productId: Number.parseInt(found[2], 16),
      });
};

type Models = ReadonlyArray<{ readonly vendorId: number; readonly productId: number }>;

/** Whether `gamepad` is of one of `models`. */
const isOf = (gamepad: Gamepad, models: Models) =>
  Option.exists(modelOf(gamepad.id), (model) =>
    models.some(
      ({ vendorId, productId }) => vendorId === model.vendorId && productId === model.productId,
    ),
  );

/** The pads among `gamepads`, read by the standard layout or one of `layouts`; empty slots, pads gone, pads of no layout known, and pads of `elsewhere`, read some other way such as through WebHID, are left out. */
export const read = (
  gamepads: ReadonlyArray<Gamepad | null>,
  layouts: ReadonlyArray<Layout> = [],
  elsewhere: Models = [],
): ReadonlyArray<Devices.Pad> =>
  gamepads.flatMap((gamepad) => {
    if (gamepad === null || !gamepad.connected || isOf(gamepad, elsewhere)) {
      return [];
    }
    const layout =
      gamepad.mapping === 'standard' ? standard : layouts.find(({ id }) => gamepad.id.includes(id));
    return layout === undefined ? [] : [padOf(gamepad, layout)];
  });

/** The pads connected now, read off the browser; none where it has no Gamepad API. */
export const poll = (
  layouts: ReadonlyArray<Layout> = [],
  elsewhere: Models = [],
): ReadonlyArray<Devices.Pad> =>
  typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function'
    ? []
    : read(navigator.getGamepads(), layouts, elsewhere);

/** The pads among `gamepads` that rumble, felt through their motors; pads of `elsewhere`, felt some other way such as through WebHID, are left out. */
export const felt = (
  gamepads: ReadonlyArray<Gamepad | null>,
  elsewhere: Models = [],
): ReadonlyArray<Haptics.Felt> =>
  gamepads.flatMap((gamepad) => {
    const actuator = gamepad?.vibrationActuator;
    if (
      gamepad === null ||
      !gamepad.connected ||
      actuator === null ||
      actuator === undefined ||
      isOf(gamepad, elsewhere)
    ) {
      return [];
    }
    return [
      {
        rumble: ({ strong, weak, seconds }) =>
          Effect.ignore(
            Effect.tryPromise(() =>
              actuator.playEffect('dual-rumble', {
                duration: seconds * 1000,
                strongMagnitude: strong,
                weakMagnitude: weak,
                startDelay: 0,
              }),
            ),
          ),
        triggers: () => Effect.void,
      },
    ];
  });

/** The pads connected now that rumble, read off the browser; none where it has no Gamepad API. */
export const feltNow = (elsewhere: Models = []): ReadonlyArray<Haptics.Felt> =>
  typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function'
    ? []
    : felt(navigator.getGamepads(), elsewhere);
