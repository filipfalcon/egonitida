import * as Markdown from '@foldkit/markdown';
import type { DocsPage } from '#src/layout/docs.ts';
import { collectHeadings } from '#src/markdown/tableOfContents.ts';
import { docViews } from '#src/markdown/views.ts';
import type { TableOfContentsEntry } from '#src/tableOfContentsEntry.ts';

/** A page of the documentation that places live views among its prose: its headings, and what it shows with the views it places given. It is read once, when its module is; only what it shows is drawn again. */
export interface LivePage {
  readonly tableOfContents: ReadonlyArray<TableOfContentsEntry>;
  readonly contentWith: (islands: Markdown.Islands) => DocsPage['content'];
}

/** A page of the documentation written in markdown, from the document its `.md` file is imported as, that places live views. */
export const livePage = (raw: unknown): LivePage => {
  const document = Markdown.decodeDocument(raw);
  const { tableOfContents, idByHeading } = collectHeadings(document);
  const views = docViews(idByHeading);
  return {
    tableOfContents,
    contentWith: (islands) => Markdown.view(document, { views, islands }),
  };
};

/** A page of the documentation written in markdown, from the document its `.md` file is imported as: what it shows, and its headings for the shell to list beside it. It is read once, when its module is. */
export const docPage = (raw: unknown): DocsPage => {
  const { tableOfContents, contentWith } = livePage(raw);
  return { content: contentWith({}), tableOfContents };
};
