import { docPage } from '#src/markdown/index.ts';
import raw from '#src/page/installation.md';

/** How to get the engine running. */
export const { content, tableOfContents } = docPage(raw);
