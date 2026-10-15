import { describe, expect, it } from '@effect/vitest';
import * as Maths from '#src/Maths.ts';

/** Every `step`th number from `from` to `to`. */
const across = (from: number, to: number, step: number) =>
  Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, index) => from + index * step);

/** How far `a` is from `b`, as a share of `b`, or as itself near nothing. */
const off = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1);

describe('Maths.sin and Maths.cos', () => {
  it('agree with the browser to within the last bits, over many turns either way', () => {
    for (const x of across(-100, 100, 0.0137)) {
      expect(off(Maths.sin(x), Math.sin(x))).toBeLessThan(4e-16);
      expect(off(Maths.cos(x), Math.cos(x))).toBeLessThan(4e-16);
    }
  });

  it('are what they are at the angles one knows', () => {
    expect(Maths.sin(0)).toBe(0);
    expect(Maths.cos(0)).toBe(1);
    expect(Maths.sin(1)).toBeCloseTo(0.8414709848078965, 15);
    expect(Maths.cos(1)).toBeCloseTo(0.5403023058681398, 15);
    expect(Maths.sin(Math.PI / 6)).toBeCloseTo(0.5, 15);
    expect(Maths.cos(Math.PI)).toBeCloseTo(-1, 15);
  });

  it('give nothing for what is no number, or no end of one', () => {
    expect(Maths.sin(Number.NaN)).toBeNaN();
    expect(Maths.cos(Number.POSITIVE_INFINITY)).toBeNaN();
  });
});

describe('Maths.atan and Maths.atan2', () => {
  it('agree with the browser to within the last bits', () => {
    for (const x of across(-50, 50, 0.0071)) {
      expect(off(Maths.atan(x), Math.atan(x))).toBeLessThan(4e-16);
    }
    for (const y of across(-3, 3, 0.37)) {
      for (const x of across(-3, 3, 0.29)) {
        expect(off(Maths.atan2(y, x), Math.atan2(y, x))).toBeLessThan(4e-16);
      }
    }
  });

  it('turn the right way in every quarter, and along the axes', () => {
    expect(Maths.atan2(1, 1)).toBeCloseTo(Math.PI / 4, 15);
    expect(Maths.atan2(1, -1)).toBeCloseTo((3 * Math.PI) / 4, 15);
    expect(Maths.atan2(-1, -1)).toBeCloseTo((-3 * Math.PI) / 4, 15);
    expect(Maths.atan2(-1, 1)).toBeCloseTo(-Math.PI / 4, 15);
    expect(Maths.atan2(1, 0)).toBe(Math.PI / 2);
    expect(Maths.atan2(-1, 0)).toBe(-Math.PI / 2);
    expect(Maths.atan2(0, -1)).toBe(Math.PI);
    expect(Maths.atan2(-0, -1)).toBe(-Math.PI);
    expect(Maths.atan2(0, 1)).toBe(0);
    expect(Maths.atan2(0, 0)).toBe(0);
  });
});

describe('Maths.asin and Maths.acos', () => {
  it('agree with the browser to within the last bits, and give nothing beyond a whole', () => {
    for (const x of across(-1, 1, 0.0013)) {
      expect(Math.abs(Maths.asin(x) - Math.asin(x))).toBeLessThan(1e-15);
      expect(Math.abs(Maths.acos(x) - Math.acos(x))).toBeLessThan(1e-15);
    }
    expect(Maths.acos(1)).toBe(0);
    expect(Maths.acos(-1)).toBe(Math.PI);
    expect(Maths.asin(1.5)).toBeNaN();
  });
});

describe('Maths.exp', () => {
  it('agrees with the browser to within the last bits, small and large', () => {
    for (const x of across(-700, 700, 0.731)) {
      expect(off(Maths.exp(x), Math.exp(x))).toBeLessThan(4e-16);
    }
    for (const x of across(-2, 2, 0.0013)) {
      expect(off(Maths.exp(x), Math.exp(x))).toBeLessThan(4e-16);
    }
  });

  it('is a whole at nothing, and runs out past what a double holds', () => {
    expect(Maths.exp(0)).toBe(1);
    expect(Maths.exp(1)).toBeCloseTo(Math.E, 15);
    expect(Maths.exp(710)).toBe(Number.POSITIVE_INFINITY);
    expect(Maths.exp(-746)).toBe(0);
    expect(Maths.exp(Number.NaN)).toBeNaN();
  });
});

describe('Maths.hypot', () => {
  it('is how long a vector of any number of sides is', () => {
    expect(Maths.hypot(3, 4)).toBe(5);
    expect(Maths.hypot(2, 3, 6)).toBe(7);
    expect(Maths.hypot()).toBe(0);
    expect(off(Maths.hypot(0.1, 0.2, 0.3), Math.hypot(0.1, 0.2, 0.3))).toBeLessThan(4e-16);
  });
});
