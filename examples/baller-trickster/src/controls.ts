import { Controls } from '@nitida/client';
import type { Component } from '@nitida/core';
import * as Baller from '#src/baller.ts';

/**
 * How the baller is played, with a pad first: the left stick places her left foot and the right stick her right, ahead and back, out and in; the triggers lift them; Triangle, or R, puts the ball back, and Square, or F, drops it onto her left foot; the directional pad, or the arrow keys, walk her. Held in, L3 or R3, a stick turns the camera about her instead, its foot holding where it was. On a keyboard, WASD place her left foot and IJKL her right, Q and U lift them, and the left and right Shift keys turn the camera by them.
 */

/** Her feet and the ball, as controls. */
export const bindings = {
  left: Controls.stick({
    pad: 'LeftStick',
    keys: { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' },
  }),
  right: Controls.stick({
    pad: 'RightStick',
    keys: { up: 'KeyI', down: 'KeyK', left: 'KeyJ', right: 'KeyL' },
  }),
  liftLeft: Controls.button({ pad: 'LeftTrigger', key: 'KeyQ' }),
  liftRight: Controls.button({ pad: 'RightTrigger', key: 'KeyU' }),
  replace: Controls.button({ pad: 'North', key: 'KeyR' }),
  leftCamera: Controls.button({ pad: 'LeftStick', key: 'ShiftLeft' }),
  rightCamera: Controls.button({ pad: 'RightStick', key: 'ShiftRight' }),
  drop: Controls.button({ pad: 'West', key: 'KeyF' }),
  walkAhead: Controls.button({ pad: 'Up', key: 'ArrowUp' }),
  walkBack: Controls.button({ pad: 'Down', key: 'ArrowDown' }),
  walkLeft: Controls.button({ pad: 'Left', key: 'ArrowLeft' }),
  walkRight: Controls.button({ pad: 'Right', key: 'ArrowRight' }),
};

/** The controls as read in a moment. */
export type Read = Controls.Read<typeof bindings>;

/** Where `controls` place her feet, after `before`: each stick its foot, across and ahead, each trigger as far as it is pulled; a stick turning the camera, its button held, leaves its foot where `before` placed it. */
export const feetOf = (
  controls: Read,
  before: Component.ValueOf<typeof Baller.Feet>,
): Component.ValueOf<typeof Baller.Feet> => {
  const left = controls.values.stick('left');
  const right = controls.values.stick('right');
  return {
    left: controls.values.button('leftCamera').held
      ? before.left
      : { x: left.x, y: left.y, lift: controls.values.button('liftLeft').value },
    right: controls.values.button('rightCamera').held
      ? before.right
      : { x: right.x, y: right.y, lift: controls.values.button('liftRight').value },
  };
};

/** Whether `controls` put the ball back: a press, once. */
export const replaced = (controls: Read): boolean => controls.values.button('replace').pressed;

/** Whether `controls` dropped the ball onto her foot: a press, once. */
export const dropped = (controls: Read): boolean => controls.values.button('drop').pressed;

/** Where `controls` send her walking: by the directional pad, or the arrow keys, ahead, back, and to either side. */
export const walkOf = (controls: Read): Component.ValueOf<typeof Baller.Walk> => {
  const held = (name: 'walkAhead' | 'walkBack' | 'walkLeft' | 'walkRight') =>
    controls.values.button(name).held ? 1 : 0;
  return { x: held('walkRight') - held('walkLeft'), y: held('walkAhead') - held('walkBack') };
};
