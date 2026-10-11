import * as Controls from '#src/Controls.ts';
import type * as Devices from '#src/Devices.ts';

/**
 * A page's controls reached with a pad: the directional pad or the left stick moves focus through what can take it within a container, a step at a press and on while a direction is held, as a game's menus do; South presses what has focus, as Enter would, and East lets go of focus, back to the game. It reads the same devices the game does, so the pad that plays the game reaches its page too.
 */

/** Moving focus, pressing, and going back, on a pad. */
export const bindings = {
  move: Controls.stick({ pad: 'LeftStick' }),
  up: Controls.button({ pad: 'Up' }),
  down: Controls.button({ pad: 'Down' }),
  left: Controls.button({ pad: 'Left' }),
  right: Controls.button({ pad: 'Right' }),
  press: Controls.button({ pad: 'South' }),
  back: Controls.button({ pad: 'East' }),
};

export interface Navigation {
  /** Moves focus, presses, or goes back, as the pad does this frame, `seconds` after the frame before. */
  readonly frame: (devices: Devices.State, seconds: number) => void;
}

/** How far the stick leans before it moves focus. */
const LEANING = 0.5;
/** How long a direction is held before focus goes on moving, and how often it moves then, in seconds. */
const REPEAT = { after: 0.4, every: 0.12 };

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** Which way focus is asked to move this frame: on through the order, back through it, or neither. */
const wayOf = (read: Controls.Read<typeof bindings>): number => {
  const { x, y } = read.values.stick('move');
  const pressed = (name: 'up' | 'down' | 'left' | 'right') => read.values.button(name).held;
  if (pressed('down') || pressed('right') || y < -LEANING || x > LEANING) {
    return 1;
  }
  if (pressed('up') || pressed('left') || y > LEANING || x < -LEANING) {
    return -1;
  }
  return 0;
};

/** Navigation within `container`. */
export const make = (container: HTMLElement): Navigation => {
  const state = {
    read: Controls.start(bindings),
    /** The way held, and for how long. */
    held: { way: 0, seconds: 0, moved: 0 },
  };

  const focusables = () =>
    [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (element) => !element.hasAttribute('disabled'),
    );

  const focused = () => {
    const active = container.ownerDocument.activeElement;
    return active instanceof HTMLElement && container.contains(active) ? active : undefined;
  };

  /** Moves focus a step `way` through the order, from the first or the last if nothing in the container has it. */
  const step = (way: number) => {
    const all = focusables();
    const current = focused();
    const at = [...all.entries()].find(([, element]) => element === current)?.[0];
    const next =
      at === undefined
        ? way > 0
          ? all[0]
          : all.at(-1)
        : all[Math.min(Math.max(at + way, 0), all.length - 1)];
    next?.focus();
  };

  return {
    frame: (devices, seconds) => {
      state.read = Controls.read(bindings, devices, state.read);
      const way = wayOf(state.read);
      if (way === 0) {
        state.held = { way: 0, seconds: 0, moved: 0 };
      } else if (way !== state.held.way) {
        state.held = { way, seconds: 0, moved: 0 };
        step(way);
      } else {
        const heldFor = state.held.seconds + seconds;
        // Moves owed by now: one at the press, then one at `after`, and one every `every` after it.
        const owed =
          heldFor < REPEAT.after ? 0 : 1 + Math.floor((heldFor - REPEAT.after) / REPEAT.every);
        for (let move = state.held.moved; move < owed; move += 1) {
          step(way);
        }
        state.held = { way, seconds: heldFor, moved: Math.max(owed, state.held.moved) };
      }
      if (state.read.values.button('press').pressed) {
        focused()?.click();
      }
      if (state.read.values.button('back').pressed) {
        focused()?.blur();
      }
    },
  };
};
