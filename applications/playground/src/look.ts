import { Controls } from '@egonitida/client';

/**
 * Looking around: how far the player turned to look, by the right stick or the arrow keys, the pad's way first. It changes only how the cubes are drawn for them, every frame, so it is the client's alone: never the game's state, and never the page's Model, which changes only when the player does something once. The stage plays it on every frame it draws, from the controls it reads then.
 */

/** The right stick looks around, and so do the arrow keys. */
export const bindings = {
  look: Controls.stick({
    pad: 'RightStick',
    keys: { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' },
  }),
};

/** How fast a full tilt of the stick turns the player around and up or down, in radians a second. */
export const TURN = { yaw: 2, pitch: 1.5 };

/** How far up or down the player can look, in radians from where they look from: a little short of a quarter turn. */
export const PITCH_LIMIT = 1.4;

/** How far the player turned: about the upright, to the left as it grows, and up as it grows, both in radians. */
export interface Look {
  readonly yaw: number;
  readonly pitch: number;
}

/** Before the player looked around: not turned at all. */
export const start: Look = { yaw: 0, pitch: 0 };

/** How far the player turned after `seconds` of `controls`, from `before`: left while the stick is held left, up while it is pushed up, never further up or down than the limit. */
export const look = (
  controls: Controls.Read<typeof bindings>,
  before: Look,
  seconds: number,
): Look => {
  const { x, y } = controls.values.stick('look');
  return {
    yaw: before.yaw - x * TURN.yaw * seconds,
    pitch: Math.min(Math.max(before.pitch + y * TURN.pitch * seconds, -PITCH_LIMIT), PITCH_LIMIT),
  };
};
