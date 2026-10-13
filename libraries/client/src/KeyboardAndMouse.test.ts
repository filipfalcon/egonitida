// @vitest-environment happy-dom
import { describe, expect, it } from '@effect/vitest';
import { Effect, Fiber, Option, Stream } from 'effect';
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
          notches: 1,
          at: Option.some({ x: 42, y: 34 }),
        });
        expect(second.mouse).toEqual({
          buttons: new Set(),
          dx: 0,
          dy: 0,
          wheel: 0,
          notches: 0,
          at: Option.some({ x: 42, y: 34 }),
        });
      }),
  );

  it.effect('tell where the mouse is from a press too, made with no move before it', () =>
    Effect.gen(function* () {
      const source = yield* KeyboardAndMouse.make(window);

      pointer('pointerdown', { button: 0, clientX: 70, clientY: 20 });

      expect(source.read().mouse.at).toEqual(Option.some({ x: 70, y: 20 }));
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

describe('the keyboard and mouse, as a page asks', () => {
  it.effect(
    'take presses of the mouse only from the element the page says, and let it go anywhere',
    () =>
      Effect.gen(function* () {
        const canvas = document.createElement('canvas');
        document.body.append(canvas);
        const source = yield* KeyboardAndMouse.make(window, { area: canvas });

        pointer('pointerdown', { button: 0 });
        const elsewhere = source.read().mouse.buttons;
        canvas.dispatchEvent(new PointerEvent('pointerdown', { button: 2, bubbles: true }));
        const onCanvas = source.read().mouse.buttons;
        pointer('pointerup', { button: 2 });
        const letGo = source.read().mouse.buttons;

        canvas.remove();
        expect([[...elsewhere], [...onCanvas], [...letGo]]).toEqual([[], [2], []]);
      }),
  );

  it.effect('tell where the mouse is only while it is over the element the page says', () =>
    Effect.gen(function* () {
      const canvas = document.createElement('canvas');
      const panel = document.createElement('div');
      document.body.append(canvas, panel);
      const source = yield* KeyboardAndMouse.make(window, { area: canvas });
      const move = (on: Element, clientX: number) =>
        on.dispatchEvent(new PointerEvent('pointermove', { clientX, clientY: 5, bubbles: true }));

      move(canvas, 10);
      const over = source.read().mouse.at;
      move(panel, 20);
      const onPanel = source.read().mouse.at;
      move(canvas, 30);
      canvas.dispatchEvent(new PointerEvent('pointerleave'));
      const left = source.read().mouse.at;

      canvas.remove();
      panel.remove();
      expect([over, onPanel, left]).toEqual([
        Option.some({ x: 10, y: 5 }),
        Option.none(),
        Option.none(),
      ]);
    }),
  );

  it.effect('keep the page from scrolling or zooming by the wheel, when the page says', () =>
    Effect.gen(function* () {
      const turn = () => new WheelEvent('wheel', { deltaY: 100, cancelable: true });
      const scrolling = turn();
      yield* Effect.scoped(
        Effect.andThen(
          KeyboardAndMouse.make(window),
          Effect.sync(() => window.dispatchEvent(scrolling)),
        ),
      );
      const kept = turn();
      const source = yield* KeyboardAndMouse.make(window, { scroll: false });
      window.dispatchEvent(kept);

      expect([scrolling.defaultPrevented, kept.defaultPrevented]).toEqual([false, true]);
      expect(source.read().mouse.wheel).toBe(100);
    }),
  );

  it.effect('hear no key typed into a field, unless the page says so of it', () =>
    Effect.gen(function* () {
      const field = document.createElement('input');
      document.body.append(field);
      const typed = (code: string) =>
        field.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
      const plain = yield* KeyboardAndMouse.make(window);
      const escaping = yield* KeyboardAndMouse.make(window, {
        ignore: (event) => KeyboardAndMouse.typing(event) && event.code !== 'Escape',
      });

      typed('KeyW');
      typed('Escape');

      field.remove();
      expect([...plain.read().keys]).toEqual([]);
      expect([...escaping.read().keys]).toEqual(['Escape']);
    }),
  );

  it.effect(
    'keep the browser from what it does with the keys the page says, and with a right click',
    () =>
      Effect.gen(function* () {
        const canvas = document.createElement('canvas');
        document.body.append(canvas);
        yield* KeyboardAndMouse.make(window, {
          area: canvas,
          preventDefault: ['Tab'],
          contextMenu: false,
        });
        const tab = new KeyboardEvent('keydown', { code: 'Tab', cancelable: true });
        const letter = new KeyboardEvent('keydown', { code: 'KeyQ', cancelable: true });
        const menu = new MouseEvent('contextmenu', { cancelable: true, bubbles: true });

        window.dispatchEvent(tab);
        window.dispatchEvent(letter);
        canvas.dispatchEvent(menu);

        canvas.remove();
        expect([tab.defaultPrevented, letter.defaultPrevented, menu.defaultPrevented]).toEqual([
          true,
          false,
          true,
        ]);
      }),
  );

  it.effect('count the notches the wheel turned, whichever way, however far each', () =>
    Effect.gen(function* () {
      const source = yield* KeyboardAndMouse.make(window);

      window.dispatchEvent(new WheelEvent('wheel', { deltaY: 300 }));
      window.dispatchEvent(new WheelEvent('wheel', { deltaY: 4 }));
      window.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }));

      expect(source.read().mouse.notches).toBe(1);
    }),
  );
});

/** A document as far as locking the pointer goes, which a test locks and releases as a browser would. */
class Locking extends EventTarget {
  pointerLockElement: Element | null = null;
  exitPointerLock() {
    this.pointerLockElement = null;
    this.dispatchEvent(new Event('pointerlockchange'));
  }
  /** The player pressing Escape, which the browser takes as letting go of the lock. */
  escape() {
    this.exitPointerLock();
  }
}

describe('the pointer locked', () => {
  it.live(
    'is locked when asked, let go when the page lets it go, and says when the player let it go instead',
    () =>
      Effect.gen(function* () {
        const locking = new Locking();
        const element = Object.assign(document.createElement('canvas'), {
          requestPointerLock: async () => {
            locking.pointerLockElement = element;
            locking.dispatchEvent(new Event('pointerlockchange'));
          },
        });
        const lock = yield* KeyboardAndMouse.pointerLock(element, locking);
        const lost = yield* lock.lost.pipe(Stream.take(1), Stream.runCollect, Effect.forkChild);
        yield* Effect.sleep('10 millis');

        yield* lock.request;
        const asked = lock.locked();
        yield* lock.release;
        const released = lock.locked();
        yield* lock.request;
        locking.escape();

        expect([asked, released, lock.locked()]).toEqual([true, false, false]);
        expect(yield* Fiber.join(lost)).toHaveLength(1);
      }).pipe(Effect.scoped),
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
