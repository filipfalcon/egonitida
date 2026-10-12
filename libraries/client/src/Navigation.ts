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
  readonly frame: (devices: Devices.Reading, seconds: number) => void;
}

/** How far the stick leans before it moves focus. */
const LEANING = 0.5;
/** How long a direction is held before focus goes on moving, and how often it moves then, in seconds. */
const REPEAT = { after: 0.4, every: 0.12 };

/** Steps through a menu, each way apart: down or right as 1, up or left as -1, none as 0. */
export interface Steps {
  readonly vertical: number;
  readonly horizontal: number;
}

/** Steps through a menu a game keeps itself, rather than through focus. */
export interface Stepper {
  /** The steps the pad takes this frame, `seconds` after the frame before. */
  readonly step: (devices: Devices.Reading, seconds: number) => Steps;
}

/** One way of stepping, along one axis: the way held, how long, and how many steps it took since. */
interface Held {
  readonly way: number;
  readonly seconds: number;
  readonly moved: number;
}

/** The bindings a stepper reads: the stick as it leans, since how far it must lean is the stepper's own. */
const stepping = {
  ...bindings,
  move: Controls.stick({ pad: 'LeftStick', deadZone: { inner: 0, outer: 1 } }),
};

const notHeld: Held = { way: 0, seconds: 0, moved: 0 };

/**
 * Steps through a menu a game keeps, as its Model does, with the directional pad and the left stick: up and down apart from left and right, a step at a press, and on while a direction is held unless `repeat` is false. The stick steps once it leans as far as `lean`, and holds that way until it comes back within `rearm`, so a flick steps once.
 */
export const stepper = (
  options: {
    readonly repeat?: { readonly after: number; readonly every: number } | false;
    readonly lean?: number;
    readonly rearm?: number;
  } = {},
): Stepper => {
  const repeat = options.repeat ?? REPEAT;
  const lean = options.lean ?? LEANING;
  const rearm = options.rearm ?? lean;
  const reading = {
    read: Controls.start(stepping),
    vertical: notHeld,
    horizontal: notHeld,
  };
  /** The way along an axis this frame: the directional pad's, else the stick's, held until it comes back within `rearm`. */
  const wayOf = (pad: number, leaning: number, before: Held) =>
    pad !== 0
      ? pad
      : Math.abs(leaning) >= lean
        ? Math.sign(leaning)
        : before.way !== 0 && Math.sign(leaning) === before.way && Math.abs(leaning) > rearm
          ? before.way
          : 0;
  /** The steps along an axis taken `way` this frame, and how it is held after. */
  const along = (
    way: number,
    before: Held,
    seconds: number,
  ): { readonly steps: number; readonly held: Held } => {
    if (way === 0) {
      return { steps: 0, held: notHeld };
    }
    if (way !== before.way) {
      return { steps: 1, held: { way, seconds: 0, moved: 0 } };
    }
    if (repeat === false) {
      return { steps: 0, held: before };
    }
    const heldFor = before.seconds + seconds;
    // Steps owed by now: one at `after`, and one every `every` after it.
    const owed =
      heldFor < repeat.after ? 0 : 1 + Math.floor((heldFor - repeat.after) / repeat.every);
    return {
      steps: Math.max(owed - before.moved, 0),
      held: { way, seconds: heldFor, moved: Math.max(owed, before.moved) },
    };
  };
  return {
    step: (devices, seconds) => {
      reading.read = Controls.read(stepping, devices, reading.read);
      const held = (name: 'up' | 'down' | 'left' | 'right') =>
        reading.read.values.button(name).held;
      const { x, y } = reading.read.values.stick('move');
      const vertical = along(
        wayOf((held('down') ? 1 : 0) - (held('up') ? 1 : 0), -y, reading.vertical),
        reading.vertical,
        seconds,
      );
      const horizontal = along(
        wayOf((held('right') ? 1 : 0) - (held('left') ? 1 : 0), x, reading.horizontal),
        reading.horizontal,
        seconds,
      );
      reading.vertical = vertical.held;
      reading.horizontal = horizontal.held;
      return {
        vertical: vertical.steps === 0 ? 0 : vertical.held.way * vertical.steps,
        horizontal: horizontal.steps === 0 ? 0 : horizontal.held.way * horizontal.steps,
      };
    },
  };
};

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** Navigation within `container`. */
export const make = (container: HTMLElement): Navigation => {
  const steps = stepper();
  const reading = { read: Controls.start(bindings) };

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
      reading.read = Controls.read(bindings, devices, reading.read);
      // Focus goes through one order, so up and left go back through it, down and right on.
      const { vertical, horizontal } = steps.step(devices, seconds);
      const way = vertical !== 0 ? vertical : horizontal;
      for (let taken = 0; taken < Math.abs(way); taken += 1) {
        step(Math.sign(way));
      }
      if (reading.read.values.button('press').pressed) {
        focused()?.click();
      }
      if (reading.read.values.button('back').pressed) {
        focused()?.blur();
      }
    },
  };
};
