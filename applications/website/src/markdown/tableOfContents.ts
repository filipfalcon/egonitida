import type { Heading, MarkdownDocument } from '@foldkit/markdown';
import { Array, Match, Option, Result } from 'effect';
import type { TableOfContentsEntry } from '#src/tableOfContentsEntry.ts';
import { parseHeadingId, slugify } from '#src/markdown/slug.ts';

/** The id of every heading of a document, by the heading: given once, so the heading drawn and its line in the table of contents always agree. */
export type HeadingIds = ReadonlyMap<Heading, string>;

/** A document's table of contents, and the id of every heading in it. */
export interface CollectedHeadings {
  readonly tableOfContents: ReadonlyArray<TableOfContentsEntry>;
  readonly idByHeading: HeadingIds;
}

/** `base`, or `base` numbered from 2 where an id is already taken. */
const unusedId = (base: string, used: ReadonlySet<string>): string => {
  if (!used.has(base)) {
    return base;
  }
  let number = 2;
  while (used.has(`${base}-${number}`)) {
    number += 1;
  }
  return `${base}-${number}`;
};

/** A heading's line in the table of contents, which lists the second to the fourth level. */
const entryOf = (
  heading: Heading,
  id: string,
  text: string,
): Result.Result<TableOfContentsEntry, void> =>
  Match.value(heading.level).pipe(
    Match.withReturnType<Result.Result<TableOfContentsEntry, void>>(),
    Match.when(2, () => Result.succeed({ id, text, level: 'h2' })),
    Match.when(3, () => Result.succeed({ id, text, level: 'h3' })),
    Match.when(4, () => Result.succeed({ id, text, level: 'h4' })),
    Match.orElse(() => Result.failVoid),
  );

/** Every heading of `document` given an id, the one written after it or one made of its text, numbered where it repeats another; and the table of contents they make. */
export const collectHeadings = (document: MarkdownDocument): CollectedHeadings => {
  const idByHeading = new Map<Heading, string>();
  const used = new Set<string>();
  const tableOfContents = Array.filterMap(document.blocks, (block) =>
    Match.value(block).pipe(
      Match.withReturnType<Result.Result<TableOfContentsEntry, void>>(),
      Match.tag('Heading', (heading) => {
        const { maybeId, text } = parseHeadingId(heading.content);
        const id = unusedId(
          Option.getOrElse(maybeId, () => slugify(text)),
          used,
        );
        used.add(id);
        idByHeading.set(heading, id);
        return entryOf(heading, id, text);
      }),
      Match.orElse(() => Result.failVoid),
    ),
  );
  return { tableOfContents, idByHeading };
};

/** The id `heading` was given, or, for one nested where the table of contents does not look, one made the same way. */
export const headingId = (idByHeading: HeadingIds, heading: Heading): string =>
  Option.getOrElse(Option.fromNullishOr(idByHeading.get(heading)), () => {
    const { maybeId, text } = parseHeadingId(heading.content);
    return Option.getOrElse(maybeId, () => slugify(text));
  });
