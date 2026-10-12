import { docPage } from '#src/markdown/index.ts';
import raw from '#src/page/welcome.md';

/** Where the documentation begins. */
export const { content, tableOfContents } = docPage(raw);
