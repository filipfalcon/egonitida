import { docPage } from '#src/markdown/index.ts';
import raw from '#src/page/principles.md';

/** The principles the engine stands on. */
export const { content, tableOfContents } = docPage(raw);
