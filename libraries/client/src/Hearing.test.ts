// @vitest-environment happy-dom
import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import * as Hearing from '#src/Hearing.ts';

const key = (type: 'keydown' | 'keyup', code: string) =>
  window.dispatchEvent(new KeyboardEvent(type, { code }));

describe('hearing the devices a player holds', () => {
  it.effect('reads every device at once: the keys and the mouse, and the pads there are', () =>
    Effect.gen(function* () {
      const hearing = yield* Hearing.make(window);

      key('keydown', 'ArrowLeft');
      const held = hearing.read();
      key('keyup', 'ArrowLeft');
      const released = hearing.read();

      expect([...held.keys]).toEqual(['ArrowLeft']);
      expect([...released.keys]).toEqual([]);
      // No pad is connected where there is no Gamepad API and no WebHID.
      expect(held.pads).toEqual([]);
      expect(hearing.hid.connections()).toEqual([]);
    }).pipe(Effect.scoped),
  );

  it.effect('hears no more once its scope closes', () =>
    Effect.gen(function* () {
      const hearing = yield* Hearing.make(window).pipe(Effect.scoped);

      key('keydown', 'KeyQ');

      expect([...hearing.read().keys]).toEqual([]);
      key('keyup', 'KeyQ');
    }),
  );

  it.effect('hears no keyboard and mouse where the page plays by pads alone', () =>
    Effect.gen(function* () {
      const hearing = yield* Hearing.make(window, { keyboardAndMouse: Option.none() });

      key('keydown', 'KeyE');
      const reading = hearing.read();
      key('keyup', 'KeyE');

      expect([...reading.keys]).toEqual([]);
      expect(reading.mouse.buttons.size).toBe(0);
    }).pipe(Effect.scoped),
  );

  it.effect(
    'holds a key pressed from outside for as many readings as asked, as a player holding it',
    () =>
      Effect.gen(function* () {
        const hearing = yield* Hearing.make(window);

        hearing.press('KeyP', 2);
        const first = hearing.read();
        const second = hearing.read();
        const third = hearing.read();

        expect([...first.keys]).toEqual(['KeyP']);
        expect([...second.keys]).toEqual(['KeyP']);
        expect([...third.keys]).toEqual([]);
      }).pipe(Effect.scoped),
  );

  it.effect('holds a key pressed from outside even where the page plays by pads alone', () =>
    Effect.gen(function* () {
      const hearing = yield* Hearing.make(window, { keyboardAndMouse: Option.none() });

      hearing.press('KeyP', 1);

      expect([...hearing.read().keys]).toEqual(['KeyP']);
    }).pipe(Effect.scoped),
  );
});
