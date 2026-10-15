import { Controls } from '@lightocean/client';
import type { Component } from '@lightocean/core';
import type * as Baller from '#src/baller.ts';

/**
 * How the baller is played, with a pad first: the left stick places her left foot and the right stick her right, ahead and back, out and in; the triggers lift them; and Triangle, or R, puts the ball back. On a keyboard, WASD place her left foot and IJKL her right, Q and U lift them.
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
};

/** The controls as read in a moment. */
export type Read = Controls.Read<typeof bindings>;

/** Where `controls` place her feet: each stick its foot, across and ahead, each trigger as far as it is pulled. */
export const feetOf = (controls: Read): Component.ValueOf<typeof Baller.Feet> => {
  const left = controls.values.stick('left');
  const right = controls.values.stick('right');
  return {
    left: { x: left.x, y: left.y, lift: controls.values.button('liftLeft').value },
    right: { x: right.x, y: right.y, lift: controls.values.button('liftRight').value },
  };
};

/** Whether `controls` put the ball back: a press, once. */
export const replaced = (controls: Read): boolean => controls.values.button('replace').pressed;
