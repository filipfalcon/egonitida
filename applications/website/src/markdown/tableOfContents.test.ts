import { describe, expect, it } from '@effect/vitest';
import { parseMarkdown } from '@foldkit/markdown/vite';
import { collectHeadings } from '#src/markdown/tableOfContents.ts';

/** The table of contents of the markdown `source`. */
const tableOfContentsOf = (source: string) =>
  collectHeadings(parseMarkdown(source)).tableOfContents;

describe('the headings of a page', () => {
  it('lists the second to fourth levels, each reached by an id made of its text', () => {
    expect(
      tableOfContentsOf(
        '# The Page\n\n## Why It Is\n\n### How’s It Done\n\n#### In `Detail`\n\n##### Too Deep',
      ),
    ).toEqual([
      { id: 'why-it-is', text: 'Why It Is', level: 'h2' },
      { id: 'hows-it-done', text: 'How’s It Done', level: 'h3' },
      { id: 'in-detail', text: 'In Detail', level: 'h4' },
    ]);
  });

  it('gives a heading that repeats another an id of its own', () => {
    expect(tableOfContentsOf('## Steps\n\n## Steps\n\n## Steps').map(({ id }) => id)).toEqual([
      'steps',
      'steps-2',
      'steps-3',
    ]);
  });

  it('takes an id written after a heading over one made of its text', () => {
    expect(tableOfContentsOf('## The State {#state}')).toEqual([
      { id: 'state', text: 'The State', level: 'h2' },
    ]);
  });
});
