import { Data, Effect, Option, type Scope } from 'effect';
import type * as Devices from '#src/Devices.ts';

/**
 * The keyboard and the mouse, in full: keys by where they are, whatever the layout, labelled by what the layout puts there; every mouse button, the wheel, and movement, raw while the pointer is locked; and the keyboard held whole in full screen. What is pressed and let go between two readings still counts, and every key is let go when the window loses focus, whose releases it never hears.
 */

// The Keyboard API is Chromium's; where there is none, labels come from where the key is and nothing is held.
declare global {
  interface Navigator {
    readonly keyboard?: {
      readonly getLayoutMap: () => Promise<ReadonlyMap<string, string>>;
      readonly lock: (codes?: ReadonlyArray<string>) => Promise<void>;
      readonly unlock: () => void;
    };
  }
}

export interface Source {
  /** The keys and the mouse since the last reading: what is held, what was tapped meanwhile, and how far the mouse and its wheel moved. */
  readonly read: () => Pick<Devices.State, 'keys' | 'mouse'>;
}

/** Listens to `type` on `target` until the scope closes. */
const listen = <K extends keyof WindowEventMap>(
  target: Window,
  type: K,
  handler: (event: WindowEventMap[K]) => void,
) =>
  Effect.acquireRelease(
    Effect.sync(() => target.addEventListener(type, handler)),
    () => Effect.sync(() => target.removeEventListener(type, handler)),
  );

/** The keyboard and mouse of `target`, a window, until the scope closes. */
export const make = (target: Window): Effect.Effect<Source, never, Scope.Scope> =>
  Effect.gen(function* () {
    const keys = { held: new Set<string>(), tapped: new Set<string>() };
    const buttons = { held: new Set<number>(), tapped: new Set<number>() };
    const moved = { dx: 0, dy: 0, wheel: 0 };
    const pointer = { at: Option.none<{ readonly x: number; readonly y: number }>() };

    yield* listen(target, 'keydown', (event) => {
      keys.held.add(event.code);
      keys.tapped.add(event.code);
    });
    yield* listen(target, 'keyup', (event) => keys.held.delete(event.code));
    yield* listen(target, 'blur', () => {
      keys.held.clear();
      buttons.held.clear();
    });
    yield* listen(target, 'pointerdown', (event) => {
      buttons.held.add(event.button);
      buttons.tapped.add(event.button);
      // A press says where the mouse is too, as a click made with no move before it, such as the first, does.
      pointer.at = Option.some({ x: event.clientX, y: event.clientY });
    });
    yield* listen(target, 'pointerup', (event) => buttons.held.delete(event.button));
    yield* listen(target, 'pointermove', (event) => {
      moved.dx += event.movementX;
      moved.dy += event.movementY;
      pointer.at = Option.some({ x: event.clientX, y: event.clientY });
    });
    yield* listen(target, 'wheel', (event) => {
      moved.wheel += event.deltaY;
    });

    return {
      read: () => {
        const read = {
          keys: new Set([...keys.held, ...keys.tapped]),
          mouse: {
            buttons: new Set([...buttons.held, ...buttons.tapped]),
            dx: moved.dx,
            dy: moved.dy,
            wheel: moved.wheel,
            at: pointer.at,
          },
        };
        keys.tapped.clear();
        buttons.tapped.clear();
        moved.dx = 0;
        moved.dy = 0;
        moved.wheel = 0;
        return read;
      },
    };
  });

const NAMED: Readonly<Record<string, string>> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Space: 'Space',
  Enter: 'Enter',
  Escape: 'Esc',
  Backspace: 'Backspace',
  Tab: 'Tab',
};

/** What the key at `code` is labelled, by what `layout` puts there if it is known, and by where it is otherwise. */
export const labelOf = (code: string, layout: Option.Option<ReadonlyMap<string, string>>): string =>
  Option.match(
    Option.flatMap(layout, (known) => Option.fromNullishOr(known.get(code))),
    {
      onSome: (typed) => typed.toUpperCase(),
      onNone: () => {
        const named = NAMED[code];
        if (named !== undefined) {
          return named;
        }
        const letter = /^Key([A-Z])$/.exec(code)?.[1];
        const digit = /^Digit(\d)$/.exec(code)?.[1];
        const modifier = /^(Shift|Control|Alt|Meta)(Left|Right)$/.exec(code)?.[1];
        return letter ?? digit ?? (modifier === 'Control' ? 'Ctrl' : modifier) ?? code;
      },
    },
  );

/** What the keyboard's layout puts on each key, where the browser tells it. */
export const layout: Effect.Effect<Option.Option<ReadonlyMap<string, string>>> = Effect.promise(
  async () => {
    const keyboard = typeof navigator === 'undefined' ? undefined : navigator.keyboard;
    return keyboard === undefined
      ? Option.none()
      : keyboard.getLayoutMap().then(Option.some, () => Option.none());
  },
);

export class Refused extends Data.TaggedError('Refused')<{ readonly reason: string }> {}

/** Locks the pointer to `element` until the scope closes, its movement raw, with no acceleration, where the browser can; to be asked in answer to a click or a key. */
export const lockPointer = (element: Element): Effect.Effect<void, Refused, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.tryPromise({
      try: async () => {
        try {
          await element.requestPointerLock({ unadjustedMovement: true });
        } catch {
          await element.requestPointerLock();
        }
      },
      catch: (cause) =>
        new Refused({
          reason: cause instanceof Error ? cause.message : 'The pointer was not locked.',
        }),
    }),
    () =>
      Effect.sync(() => {
        if (document.pointerLockElement === element) {
          document.exitPointerLock();
        }
      }),
  );

/** Holds the keyboard whole, `codes` or every key, so the game hears keys the browser would take, such as Escape, until the scope closes; it holds only in full screen, and only where the browser can. */
export const lockKeyboard = (
  codes?: ReadonlyArray<string>,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      await navigator.keyboard?.lock(codes).catch(() => undefined);
    }),
    () => Effect.sync(() => navigator.keyboard?.unlock()),
  );
