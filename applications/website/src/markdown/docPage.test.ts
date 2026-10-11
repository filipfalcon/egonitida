import { describe, expect, it } from '@effect/vitest';
import { docPage } from '#src/markdown/docPage.ts';
import example from '#src/markdown/example.md';

describe('a page of the documentation written in markdown', () => {
  it('is read through the markdown plugin, and lists its headings', () => {
    expect(docPage(example).tableOfContents).toEqual([
      { id: 'first', text: 'First', level: 'h2' },
      { id: 'inside', text: 'Inside', level: 'h3' },
      { id: 'second', text: 'Second', level: 'h2' },
    ]);
  });
});
