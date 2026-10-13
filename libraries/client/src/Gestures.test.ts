// @vitest-environment happy-dom
import { describe, expect, it } from '@effect/vitest';
import { Chunk, Effect, Fiber, Stream } from 'effect';
import * as Gestures from '#src/Gestures.ts';

describe('the gestures of a person at the page', () => {
  it.live('are a press of a pointer, a touch let go, and a key pressed, each once', () =>
    Effect.gen(function* () {
      const heard = yield* Gestures.of(window).pipe(
        Stream.take(3),
        Stream.runCollect,
        Effect.forkScoped({ startImmediately: true }),
      );
      // Listening begins once the Stream has started running.
      yield* Effect.sleep('10 millis');

      window.dispatchEvent(new PointerEvent('pointerdown'));
      window.dispatchEvent(new PointerEvent('pointermove'));
      window.dispatchEvent(new Event('touchend'));
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA' }));

      expect(Chunk.size(Chunk.fromIterable(yield* Fiber.join(heard)))).toBe(3);
    }).pipe(Effect.scoped),
  );
});
