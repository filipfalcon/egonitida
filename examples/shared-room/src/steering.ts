import { Controls, type Devices } from '@nitida/client';

/**
 * How a walker is steered: by the arrows or WASD, or the left stick on a pad, and what a moment of them comes to in the room's demands.
 */

/** Steering as a stick: the arrows or WASD, or the left stick. */
export const bindings = {
  move: Controls.stick({
    pad: 'LeftStick',
    keys: [
      { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' },
      { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' },
    ],
  }),
};

/** What a moment of the controls comes to: which way the player steers, on the floor. */
export interface Steered {
  readonly controls: Controls.Read<typeof bindings>;
  readonly steering: { readonly x: number; readonly z: number };
}

/** Before anything is held. */
export const start: Steered = { controls: Controls.start(bindings), steering: { x: 0, z: 0 } };

/** What `devices` come to after `before`: steering on the floor as the camera looks at it, up the screen as away from it. */
export const steer = (devices: Devices.Reading, before: Steered): Steered => {
  const controls = Controls.read(bindings, devices, before.controls);
  const move = controls.values.stick('move');
  return { controls, steering: { x: move.x, z: move.y === 0 ? 0 : -move.y } };
};
