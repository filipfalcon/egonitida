import { Controls, type Devices } from '@lightocean/client';
import { Option } from 'effect';
import * as Figure from '#src/figure.ts';

/**
 * How the figure is shaped, with whatever the player holds: up and down go through her dials, left and right turn the one chosen, by the arrow keys or a pad's directional pad. Which dial is chosen only the page reads, so it is the page's, never the game's; a turn reaches the game as the action it comes to.
 */

/** Going through the dials and turning the one chosen, as buttons. */
export const bindings = {
  previous: Controls.button({ pad: 'Up', key: 'ArrowUp' }),
  next: Controls.button({ pad: 'Down', key: 'ArrowDown' }),
  less: Controls.button({ pad: 'Left', key: 'ArrowLeft' }),
  more: Controls.button({ pad: 'Right', key: 'ArrowRight' }),
};

/** What a moment of the controls comes to: the dial chosen, and the turn the player just gave it, if any. */
export interface Played {
  readonly controls: Controls.Read<typeof bindings>;
  readonly chosen: Figure.Dial;
  readonly turned: Option.Option<Figure.Turn>;
}

/** Before the player did anything: her first dial chosen, and nothing turned. */
export const start: Played = {
  controls: Controls.start(bindings),
  chosen: 'chest',
  turned: Option.none(),
};

/** The dial `by` along the list from `dial`, round from the last to the first and back. */
const along = (dial: Figure.Dial, by: number): Figure.Dial => {
  const count = Figure.DIALS.length;
  return Figure.DIALS[(Figure.DIALS.indexOf(dial) + by + count) % count] ?? dial;
};

/** What `devices` come to after `before`: the dial chosen, moved up or down the list by a press, and the turn a press of left or right gives it. */
export const play = (devices: Devices.Reading, before: Played): Played => {
  const controls = Controls.read(bindings, devices, before.controls);
  const pressed = (name: keyof typeof bindings) => controls.values.button(name).pressed;
  const chosen = along(before.chosen, (pressed('next') ? 1 : 0) - (pressed('previous') ? 1 : 0));
  const toward = pressed('more')
    ? Option.some('More' as const)
    : pressed('less')
      ? Option.some('Less' as const)
      : Option.none();
  return {
    controls,
    chosen,
    turned: Option.map(toward, (way) => ({ dial: chosen, toward: way })),
  };
};
