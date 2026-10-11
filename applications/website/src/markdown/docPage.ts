import * as Markdown from '@foldkit/markdown';
import type { DocsPage } from '#src/layout/docs.ts';
import { collectHeadings } from '#src/markdown/tableOfContents.ts';
import { docViews } from '#src/markdown/views.ts';

/** A page of the documentation written in markdown, from the document its `.md` file is imported as: what it shows, and its headings for the shell to list beside it. It is read once, when its module is. */
export const docPage = (raw: unknown): DocsPage => {
  const document = Markdown.decodeDocument(raw);
  const { tableOfContents, idByHeading } = collectHeadings(document);
  return { content: Markdown.view(document, { views: docViews(idByHeading) }), tableOfContents };
};
