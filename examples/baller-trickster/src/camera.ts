import type * as BallerControls from '#src/controls.ts';

/**
 * Where the player looks at her from: around her, from behind and above, turned by a stick while its button, L3 or R3, is held; or, while a photograph is taken, from wherever the camera floats, as a camera on a drone does, looking where it is turned through a lens as long as it is zoomed. It changes only how the game is drawn for the player, every frame, so it is the page's alone, played on from the controls each frame and given to the camera's rig as the drawing's input.
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

/** How wide a camera's lens is to begin with, as the field of view up and down in degrees, as Three's camera has it. */
export const LENS = 50;

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

/** A camera floating free: where it stands, which way it heads about the upright, looking along +z at nothing and to its left as it grows, how far up it looks from level, both in radians, and its lens, as the field of view up and down in degrees, as Three has it. */
export interface Floating {
  readonly at: { readonly x: number; readonly y: number; readonly z: number };
  readonly heading: number;
  readonly pitch: number;
  readonly lens: number;
}

/** How fast a camera floats at a full tilt or press, in metres a second, along the ground and up; how fast it turns, in radians a second; and how fast it zooms, its lens a share shorter or longer a second. */
export const FLOATING = { along: 1.5, up: 1, turn: 1.2, zoom: 0.8 };

/** How low a floating camera goes, above the ground; how steeply it looks, up or down, in radians; and the narrowest and widest its lens zooms, in degrees. */
export const LOWEST_FLOAT = 0.05;
export const STEEPEST = 1.45;
export const NARROWEST = 8;
export const WIDEST = 80;

/** Where a player looks from: about her, or floating free. */
export type Viewpoint =
  | { readonly _tag: 'Orbiting'; readonly orbit: Orbit }
  | { readonly _tag: 'Floating'; readonly floating: Floating };

/** Looking at her as a game starts: behind her, a little above. */
export const looking: Viewpoint = { _tag: 'Orbiting', orbit: start };

/** The way a floating camera looks, of length one. */
export const lookingOf = (floating: Floating) => ({
  x: Math.sin(floating.heading) * Math.cos(floating.pitch),
  y: Math.sin(floating.pitch),
  z: Math.cos(floating.heading) * Math.cos(floating.pitch),
});

/** A camera floating where one stands at `at`, looking the way `way`, of length one, through a lens of `lens` degrees. */
export const floatingFrom = (
  at: Floating['at'],
  way: { readonly x: number; readonly y: number; readonly z: number },
  lens: number,
): Floating => ({
  at: { x: at.x, y: at.y, z: at.z },
  heading: Math.atan2(way.x, way.z),
  pitch: Math.asin(Math.min(Math.max(way.y, -1), 1)),
  lens,
});

/** A floating camera after `seconds` of `controls`, from `before`: the left stick, or WASD, floating it ahead where it heads and aside; the triggers, or Q and U, sinking and raising it; the right stick, or IJKL, turning it; and the bumpers, or + and -, zooming it in and out. */
export const float = (
  controls: BallerControls.Read,
  before: Floating,
  seconds: number,
): Floating => {
  const moving = controls.values.stick('left');
  const turning = controls.values.stick('right');
  const rising =
    controls.values.button('liftRight').value - controls.values.button('liftLeft').value;
  const zooming = controls.values.button('zoomOut').value - controls.values.button('zoomIn').value;
  const ahead = { x: Math.sin(before.heading), z: Math.cos(before.heading) };
  // Its right, heading along +z, lies toward -x.
  const right = { x: -Math.cos(before.heading), z: Math.sin(before.heading) };
  const along = FLOATING.along * seconds;
  return {
    at: {
      x: before.at.x + (ahead.x * moving.y + right.x * moving.x) * along,
      y: Math.max(before.at.y + rising * FLOATING.up * seconds, LOWEST_FLOAT),
      z: before.at.z + (ahead.z * moving.y + right.z * moving.x) * along,
    },
    heading: before.heading - turning.x * FLOATING.turn * seconds,
    pitch: Math.min(
      Math.max(before.pitch + turning.y * FLOATING.turn * seconds, -STEEPEST),
      STEEPEST,
    ),
    lens: Math.min(
      Math.max(before.lens * Math.exp(zooming * FLOATING.zoom * seconds), NARROWEST),
      WIDEST,
    ),
  };
};
