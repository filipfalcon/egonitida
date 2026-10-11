// @vitest-environment happy-dom
import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import * as KeyboardAndMouse from '#src/KeyboardAndMouse.ts';

const key = (type: 'keydown' | 'keyup', code: string) =>
  window.dispatchEvent(new KeyboardEvent(type, { code }));
const pointer = (type: 'pointerdown' | 'pointerup' | 'pointermove', init: PointerEventInit) =>
  window.dispatchEvent(new PointerEvent(type, init));

describe('the keyboard and mouse', () => {
  it.effect('tell the keys held, by where they are, and a tap shorter than a reading', () =>
    Effect.gen(function* () {
      const source = yield* KeyboardAndMouse.make(window);

      key('keydown', 'KeyW');
      key('keydown', 'KeyR');
      key('keyup', 'KeyR');
      const first = source.read();
      const second = source.read();

      expect([...first.keys].toSorted()).toEqual(['KeyR', 'KeyW']);
      expect([...second.keys]).toEqual(['KeyW']);
    }),
  );

  it.effect('let go of every key when the window loses focus, whose releases it never hears', () =>
    Effect.gen(function* () {
      const source = yield* KeyboardAndMouse.make(window);

      key('keydown', 'KeyW');
      source.read();
      window.dispatchEvent(new Event('blur'));

      expect([...source.read().keys]).toEqual([]);
    }),
  );

  it.effect(
    'tell the mouse buttons held and tapped, how far it and its wheel moved, and where it is',
    () =>
      Effect.gen(function* () {
        const source = yield* KeyboardAndMouse.make(window);

        pointer('pointerdown', { button: 2 });
        pointer('pointerup', { button: 2 });
        pointer('pointermove', { movementX: 3, movementY: -1, clientX: 40, clientY: 30 });
        pointer('pointermove', { movementX: 2, movementY: 4, clientX: 42, clientY: 34 });
        window.dispatchEvent(new WheelEvent('wheel', { deltaY: 120 }));
        const first = source.read();
        const second = source.read();

        expect(first.mouse).toEqual({
          buttons: new Set([2]),
          dx: 5,
          dy: 3,
          wheel: 120,
          at: Option.some({ x: 42, y: 34 }),
        });
        expect(second.mouse).toEqual({
          buttons: new Set(),
          dx: 0,
          dy: 0,
          wheel: 0,
          at: Option.some({ x: 42, y: 34 }),
        });
      }),
  );

  it.effect('stop listening once its scope closes', () =>
    Effect.gen(function* () {
      const source = yield* Effect.scoped(KeyboardAndMouse.make(window));

      key('keydown', 'KeyW');

      expect([...source.read().keys]).toEqual([]);
    }),
  );
});

describe('the label of a key', () => {
  it('is what the layout puts there, where the browser tells it', () => {
    const azerty = new Map([['KeyW', 'z']]);

    expect(KeyboardAndMouse.labelOf('KeyW', Option.some(azerty))).toBe('Z');
  });

  it('is read off where the key is, where the browser does not tell the layout', () => {
    expect(
      ['KeyW', 'Digit1', 'ArrowUp', 'Space', 'ShiftLeft'].map((code) =>
        KeyboardAndMouse.labelOf(code, Option.none()),
      ),
    ).toEqual(['W', '1', '↑', 'Space', 'Shift']);
  });
});
