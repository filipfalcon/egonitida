import { describe, expect, it } from '@effect/vitest';
import { inertHtml as h } from 'foldkit/html';
import { docPage, livePage } from '#src/markdown/docPage.ts';
import example from '#src/markdown/example.md';
import keyTerms from '#src/page/keyTerms.md';

describe('a page of the documentation written in markdown', () => {
  it('is read through the markdown plugin, and lists its headings', () => {
    expect(docPage(example).tableOfContents).toEqual([
      { id: 'first', text: 'First', level: 'h2' },
      { id: 'inside', text: 'Inside', level: 'h3' },
      { id: 'second', text: 'Second', level: 'h2' },
    ]);
  });

  it('draws the live views it places where it places them, each time it is drawn', () => {
    const placed: Array<string> = [];
    const page = livePage(keyTerms);
    const draw = () =>
      page.contentWith({
        FirstThingsFirst: () => {
          placed.push('FirstThingsFirst');
          return h.div([], []);
        },
        StatePress: () => {
          placed.push('StatePress');
          return h.div([], []);
        },
      });

    draw();
    draw();

    expect(placed).toEqual(['FirstThingsFirst', 'StatePress', 'FirstThingsFirst', 'StatePress']);
  });
});
