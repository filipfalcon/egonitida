import { Effect, Queue, Stream } from 'effect';

/**
 * The gestures of a person at a page: a press of a pointer, a touch let go, and a key pressed. A browser lets a page start sound, or ask for a device, only in answer to one of these, so what must wait for the person to act, such as unlocking a game's audio, waits for the next of them.
 */

/** The events a browser counts as a person acting on a page. */
const GESTURES = ['pointerdown', 'touchend', 'keydown'] as const;

/** Every gesture of a person at `target`, a window, from now on, until the Stream ends. */
export const of = (target: Window): Stream.Stream<void> =>
  Stream.callback<void>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const listener = () => {
          Queue.offerUnsafe(queue, undefined);
        };
        for (const type of GESTURES) target.addEventListener(type, listener);
        return listener;
      }),
      (listener) =>
        Effect.sync(() => {
          for (const type of GESTURES) target.removeEventListener(type, listener);
        }),
    ),
  );
