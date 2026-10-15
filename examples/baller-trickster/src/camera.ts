import type * as BallerControls from '#src/controls.ts';

/**
 * Where the player looks at her from: around her, from behind and above, turned by a stick while its button, L3 or R3, is held. It changes only how the game is drawn for the player, every frame, so it is the page's alone, played on from the controls each frame and given to the camera's rig as the drawing's input.
 */

/** Where the camera stands about her: turned about the upright from behind her, to her left as it grows, and up from level, both in radians. */
export interface Orbit {
  readonly around: number;
  readonly up: number;
}

/** How fast a full tilt of a stick turns the camera about her and up or down, in radians a second. */
export const TURN = { around: 2.2, up: 1.4 };

/** How low and how high the camera goes, in radians up from level: never under the ground, never straight over her head. */
export const LOWEST = 0.05;
export const HIGHEST = 1.3;

/** Behind her, a little above. */
export const start: Orbit = { around: 0, up: 0.35 };

/** The camera after `seconds` of `controls`, from `before`: turned by every stick whose button is held, around her as it goes aside and up as it goes up. */
export const orbit = (controls: BallerControls.Read, before: Orbit, seconds: number): Orbit => {
  const turning = [
    ...(controls.values.button('leftCamera').held ? [controls.values.stick('left')] : []),
    ...(controls.values.button('rightCamera').held ? [controls.values.stick('right')] : []),
  ];
  const { x, y } = turning.reduce((sum, stick) => ({ x: sum.x + stick.x, y: sum.y + stick.y }), {
    x: 0,
    y: 0,
  });
  return {
    around: before.around + x * TURN.around * seconds,
    up: Math.min(Math.max(before.up + y * TURN.up * seconds, LOWEST), HIGHEST),
  };
};
