import { docPage } from '#src/markdown/index.ts';
// The architecture as the repository keeps it, so the page and the file are one.
import raw from '../../../../docs/architecture.md';

/** Why the engine is built the way it is: its principles, decisions, and what comes next. */
export const { content, tableOfContents } = docPage(raw);
