import { Effect, Option, type Scope } from 'effect';
import type * as Devices from '#src/Devices.ts';
import * as Gamepads from '#src/Gamepads.ts';
import * as Hid from '#src/Hid.ts';
import * as KeyboardAndMouse from '#src/KeyboardAndMouse.ts';

/**
 * What a page hears of every device the player holds, read as one moment whenever it asks, such as once a frame: the keys and the mouse, the pads read through WebHID, and the pads the Gamepad API reads that WebHID does not, so none counts twice.
 */

/** How a page hears its devices: the keyboard and the mouse as `keyboardAndMouse` says, the pads WebHID reads through `drivers`, and the Gamepad API's pads of a layout other than the standard one by `layouts`. */
export interface Options {
  readonly keyboardAndMouse?: KeyboardAndMouse.Options;
  readonly drivers?: ReadonlyArray<Hid.Driver>;
  readonly layouts?: ReadonlyArray<Gamepads.Layout>;
}

/** The devices a page hears: what they all do at the moment `read` is asked, and the pads WebHID reaches, which a page also feels and lights through. */
export interface Hearing {
  readonly read: () => Devices.Reading;
  readonly hid: Hid.Pool;
}

/** The devices of `target`, a window, heard as `options` say, until the scope closes. */
export const make = (
  target: Window,
  options: Options = {},
): Effect.Effect<Hearing, never, Scope.Scope> =>
  Effect.gen(function* () {
    const keyboardAndMouse = yield* KeyboardAndMouse.make(target, options.keyboardAndMouse);
    const hid = yield* Hid.pool(options.drivers ?? []);
    const layouts = options.layouts ?? [];
    return {
      read: () => ({
        pads: [
          ...hid.connections().flatMap((connection) => Option.toArray(connection.pad())),
          ...Gamepads.poll(
            layouts,
            hid.connections().map(({ model }) => model),
          ),
        ],
        ...keyboardAndMouse.read(),
      }),
      hid,
    };
  });
