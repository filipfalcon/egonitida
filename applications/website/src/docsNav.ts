import { Array, Option, pipe } from 'effect';
import { architectureRouter } from '#src/route.ts';

/**
 * The documentation's navigation: its sections in the order they are read, each with its pages. The sidebar lists them, and every page leads to the one before it and the one after it. A page is added here, with its route in `route.ts`.
 */

/** A page of the documentation, as the navigation lists it: what it is called, and where it is. */
export interface NavPage {
  readonly label: string;
  readonly href: string;
}

/** A section of the documentation, and its pages in the order they are read. */
export interface DocsSection {
  readonly label: string;
  readonly pages: ReadonlyArray<NavPage>;
}

/** The documentation's sections, in the order they are read. */
export const docsSections: ReadonlyArray<DocsSection> = [
  { label: 'Introduction', pages: [{ label: 'Architecture', href: architectureRouter() }] },
];

/** The pages before and after a page, where there are any. */
export interface Neighbours {
  readonly maybePrevious: Option.Option<NavPage>;
  readonly maybeNext: Option.Option<NavPage>;
}

/** The page of `sections` before the one at `pathname`, and the one after it, read straight on from one section into the next. */
export const neighboursOf = (
  sections: ReadonlyArray<DocsSection>,
  pathname: string,
): Neighbours => {
  const pages = Array.flatMap(sections, ({ pages }) => pages);
  return Option.match(
    Array.findFirstIndex(pages, ({ href }) => href === pathname),
    {
      onNone: () => ({ maybePrevious: Option.none(), maybeNext: Option.none() }),
      onSome: (index) => ({
        maybePrevious: Array.get(pages, index - 1),
        maybeNext: Array.get(pages, index + 1),
      }),
    },
  );
};

/** The section of `sections` the page at `pathname` is in, if it lists it. */
export const sectionOf = (
  sections: ReadonlyArray<DocsSection>,
  pathname: string,
): Option.Option<DocsSection> =>
  pipe(
    sections,
    Array.findFirst(({ pages }) => pages.some(({ href }) => href === pathname)),
  );
