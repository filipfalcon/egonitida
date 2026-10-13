import { docPage } from '#src/markdown/index.ts';
import raw from '#src/page/foundation.md';

/** What the whole engine stands on: a state, its input, and the step from one state to the next. */
export const { content, tableOfContents } = docPage(raw);
