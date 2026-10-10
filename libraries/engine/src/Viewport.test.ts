import { describe, expect, it } from '@effect/vitest';
import * as Viewport from '#src/Viewport.ts';

describe('Viewport', () => {
  describe('toPointer', () => {
    const bounds = { left: 100, top: 50, width: 400, height: 200 };

    it('maps the centre of the canvas to the origin', () => {
      expect(Viewport.toPointer(bounds, { clientX: 300, clientY: 150 })).toEqual({ x: 0, y: 0 });
    });

    it('maps the top-left corner to (-1, 1), with y pointing up', () => {
      expect(Viewport.toPointer(bounds, { clientX: 100, clientY: 50 })).toEqual({ x: -1, y: 1 });
    });

    it('maps the bottom-right corner to (1, -1)', () => {
      expect(Viewport.toPointer(bounds, { clientX: 500, clientY: 250 })).toEqual({ x: 1, y: -1 });
    });
  });
});
