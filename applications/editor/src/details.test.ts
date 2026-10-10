import { describe, expect, it } from '@effect/vitest';
import { fromHex, parseNumber, toHex, withComponent } from '#src/details.ts';

describe('details', () => {
  it('reads a typed number, and nothing typed as not a number', () => {
    expect(parseNumber('1.5')).toBe(1.5);
    expect(parseNumber('-2')).toBe(-2);
    expect(parseNumber('')).toBeNaN();
    expect(parseNumber('  ')).toBeNaN();
    expect(parseNumber('-')).toBeNaN();
  });

  it('writes a colour as the hex a colour input expects, padded to six digits', () => {
    expect(toHex(0xff6b6b)).toBe('#ff6b6b');
    expect(toHex(0x0000ff)).toBe('#0000ff');
  });

  it('reads a colour input’s hex back as a whole number', () => {
    expect(fromHex('#ff6b6b')).toBe(0xff6b6b);
    expect(fromHex('#0000ff')).toBe(0x0000ff);
  });

  it('replaces one component of a vector, leaving the others', () => {
    expect(withComponent([1, 2, 3], 1, 9)).toEqual([1, 9, 3]);
  });
});
