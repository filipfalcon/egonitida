import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import * as Devices from '#src/Devices.ts';
import * as Gamepads from '#src/Gamepads.ts';

/** A gamepad as the Gamepad API gives one: `pressed` buttons by index, and its axes. */
const gamepad = (options: {
  readonly id?: string;
  readonly mapping?: string;
  readonly connected?: boolean;
  readonly count?: number;
  readonly pressed?: ReadonlyArray<number>;
  readonly axes?: ReadonlyArray<number>;
}): Gamepads.Gamepad => ({
  id: options.id ?? 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)',
  mapping: options.mapping ?? 'standard',
  connected: options.connected ?? true,
  buttons: Array.from({ length: options.count ?? 17 }, (_, index) => ({
    value: options.pressed?.includes(index) === true ? 1 : 0,
  })),
  axes: options.axes ?? [0, 0, 0, 0],
});

describe('gamepads', () => {
  it('read a standard pad by where its buttons and sticks are', () => {
    const [pad] = Gamepads.read([gamepad({ pressed: [0, 7, 9, 12], axes: [0.5, -1, 0, 0.25] })]);

    expect(pad?.buttons).toEqual({
      ...Devices.idlePad.buttons,
      South: 1,
      RightTrigger: 1,
      Start: 1,
      Up: 1,
    });
    expect(pad?.axes).toEqual({ LeftX: 0.5, LeftY: -1, RightX: 0, RightY: 0.25 });
  });

  it('leave out empty slots, pads gone, and pads of no layout it knows', () => {
    expect(
      Gamepads.read([
        null,
        gamepad({ connected: false }),
        gamepad({ id: 'A wheel', mapping: '', count: 8, axes: [0.3] }),
      ]),
    ).toEqual([]);
  });

  it('read a pad of no standard layout through a layout given as data', () => {
    const wheel: Gamepads.Layout = {
      id: 'A wheel',
      buttons: { South: 2, Start: 7 },
      axes: { LeftX: { index: 0 }, LeftY: { index: 1, inverted: true } },
    };

    const [pad] = Gamepads.read(
      [
        gamepad({
          id: 'Brand A wheel model',
          mapping: '',
          count: 8,
          pressed: [2],
          axes: [0.3, 0.6],
        }),
      ],
      [wheel],
    );

    expect(pad?.buttons).toEqual({ ...Devices.idlePad.buttons, South: 1 });
    expect(pad?.axes).toEqual({ ...Devices.idlePad.axes, LeftX: 0.3, LeftY: -0.6 });
  });

  it.effect(
    'rumble through the Gamepad API, every pad that can, those read some other way left out',
    () => {
      const played: Array<{ readonly type: string; readonly params: unknown }> = [];
      const actuator = {
        playEffect: async (
          type: GamepadHapticEffectType,
          params?: GamepadEffectParameters,
        ): Promise<GamepadHapticsResult> => {
          played.push({ type, params });
          return 'complete';
        },
      };
      const felt = Gamepads.felt(
        [
          { ...gamepad({ id: 'Xbox Wireless Controller' }), vibrationActuator: actuator },
          gamepad({ id: 'Without motors' }),
          { ...gamepad({}), vibrationActuator: actuator },
        ],
        [{ vendorId: 0x054c, productId: 0x0ce6 }],
      );

      return Effect.gen(function* () {
        yield* Effect.forEach(felt, (pad) => pad.rumble({ strong: 1, weak: 0.5, seconds: 0.2 }));

        expect(played).toEqual([
          {
            type: 'dual-rumble',
            params: { duration: 200, strongMagnitude: 1, weakMagnitude: 0.5, startDelay: 0 },
          },
        ]);
      });
    },
  );

  it('leave out pads read some other way, such as a DualSense through WebHID, by their vendor and product', () => {
    const read = Gamepads.read(
      [gamepad({}), gamepad({ id: '054c-0ce6-Wireless Controller' })],
      [],
      [{ vendorId: 0x054c, productId: 0x0ce6 }],
    );

    expect(read).toEqual([]);
  });
});
