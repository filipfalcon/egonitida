import { Controls, type Devices } from '@egonitida/client';
import { Option } from 'effect';

/**
 * How a survivor is played, with whatever the player holds: the controls bound to every kind of device, the pad's way first, and what a moment of them comes to in the horde's own demands and actions.
 */

/** Walking and aiming as sticks, firing and rising again as buttons; walking by WASD or the arrows, and on a pad, Start rises again, as Options on a DualSense. */
export const bindings = {
  move: Controls.stick({
    pad: 'LeftStick',
    keys: [
      { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' },
      { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' },
    ],
  }),
  aim: Controls.stick({ pad: 'RightStick' }),
  fire: Controls.button({ pad: 'RightTrigger', mouse: 0 }),
  restart: Controls.button({ pad: 'Start', key: 'KeyR' }),
};

/** What a moment of the controls comes to: the survivor's stick, and whether they fired or rose again just now. */
export interface Played {
  readonly controls: Controls.Read<typeof bindings>;
  readonly stick: { readonly x: number; readonly z: number; readonly aim: number };
  readonly fired: boolean;
  readonly restarted: boolean;
}

export const start: Played = {
  controls: Controls.start(bindings),
  stick: { x: 0, z: 0, aim: 0 },
  fired: false,
  restarted: false,
};

/**
 * What `devices` come to after `before`: walking on the floor as the camera looks at it, up the screen as away from it; aiming by the right stick on a pad, kept where it was once the stick is let go, and by the mouse, at `mouseAim`, otherwise.
 */
export const play = (
  devices: Devices.Reading,
  before: Played,
  mouseAim: Option.Option<number>,
): Played => {
  const controls = Controls.read(bindings, devices, before.controls);
  const move = controls.values.stick('move');
  const aimed = controls.values.stick('aim');
  const onPad = Option.contains(controls.active, 'Pad');
  const aim = onPad
    ? aimed.x === 0 && aimed.y === 0
      ? before.stick.aim
      : Math.atan2(-aimed.y, aimed.x)
    : Option.getOrElse(mouseAim, () => before.stick.aim);
  return {
    controls,
    stick: { x: move.x, z: move.y === 0 ? 0 : -move.y, aim },
    fired: controls.values.button('fire').pressed,
    restarted: controls.values.button('restart').pressed,
  };
};
