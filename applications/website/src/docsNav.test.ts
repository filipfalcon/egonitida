import { describe, expect, it } from '@effect/vitest';
import { Option } from 'effect';
import * as DocsNav from '#src/docsNav.ts';

/** Two sections of three pages, enough to go from one section into the next. */
const sections: ReadonlyArray<DocsNav.DocsSection> = [
  {
    label: 'Introduction',
    pages: [
      { label: 'Get Started', href: '/get-started' },
      { label: 'Architecture', href: '/architecture' },
    ],
  },
  { label: 'Core', pages: [{ label: 'World', href: '/core/world' }] },
];

describe('the documentation navigation', () => {
  it('leads from a page to the one before it and the one after it, across sections', () => {
    expect(DocsNav.neighboursOf(sections, '/architecture')).toEqual({
      maybePrevious: Option.some({ label: 'Get Started', href: '/get-started' }),
      maybeNext: Option.some({ label: 'World', href: '/core/world' }),
    });
  });

  it('leads nowhere before the first page, nor after the last', () => {
    expect(DocsNav.neighboursOf(sections, '/get-started').maybePrevious).toEqual(Option.none());
    expect(DocsNav.neighboursOf(sections, '/core/world').maybeNext).toEqual(Option.none());
  });

  it('leads nowhere from a page it does not list', () => {
    expect(DocsNav.neighboursOf(sections, '/nowhere')).toEqual({
      maybePrevious: Option.none(),
      maybeNext: Option.none(),
    });
  });

  it('finds the section a page is in, and none for a page it does not list', () => {
    expect(Option.map(DocsNav.sectionOf(sections, '/core/world'), ({ label }) => label)).toEqual(
      Option.some('Core'),
    );
    expect(DocsNav.sectionOf(sections, '/nowhere')).toEqual(Option.none());
  });
});
