import { describe, expect, it } from '@effect/vitest';
import * as Styled from '#src/Styled.ts';

/** Foldkit's attribute builders, as far as a style uses them, giving back what each was built from. */
const h = {
  Class: (value: string) => ({ _tag: 'Class', value }),
  Style: (value: Readonly<Record<string, string>>) => ({ _tag: 'Style', value }),
};

describe('styled', () => {
  it("gives an element StyleX's classes, and its inline styles as text", () => {
    expect(
      Styled.fromProps(h, { className: 'x1 x2', style: { '--offset': '4px', opacity: 0.5 } }),
    ).toEqual([
      { _tag: 'Class', value: 'x1 x2' },
      { _tag: 'Style', value: { '--offset': '4px', opacity: '0.5' } },
    ]);
  });

  it('gives nothing for styles that came to nothing', () => {
    expect(Styled.fromProps(h, {})).toEqual([]);
    expect(Styled.fromProps(h, { className: '' })).toEqual([]);
  });
});
