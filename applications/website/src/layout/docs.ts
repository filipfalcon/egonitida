import { Styled } from '@egonitida/foldkit';
import * as stylex from '@stylexjs/stylex';
import { Array, Option } from 'effect';
import type { Html, HtmlBuilder } from 'foldkit/html';
import {
  type DocsSection,
  type NavPage,
  docsSections,
  listedSections,
  neighboursOf,
} from '#src/docsNav.ts';
import { DISCORD, REPOSITORY } from '#src/links.ts';
import type { Message, Model } from '#src/main.ts';
import { homeRouter } from '#src/route.ts';
import type { TableOfContentsEntry } from '#src/tableOfContentsEntry.ts';
// Relative, as StyleX finds variables by the path of the module that defines them.
import { colours } from '../tokens.stylex.ts';

/**
 * The documentation's shell, around every page of it: a bar with the way home, the sections and their pages beside the page, the page itself with the ones before and after it, and the headings of the page beside it, where it has any. On a narrow screen the sections fold into a menu above the page, and the headings are left out.
 */

/** A page of the documentation, as its shell draws it: what it shows, and the headings it lists beside it. */
export interface DocsPage {
  readonly content: Html;
  readonly tableOfContents: ReadonlyArray<TableOfContentsEntry>;
}

/** The id of the page's own content, which the link to skip the navigation leads to. */
const CONTENT_ID = 'content';

const BAR_HEIGHT = 64;
const NARROW = '@media (max-width: 860px)';
const WITHOUT_HEADINGS = '@media (max-width: 1200px)';

const styles = stylex.create({
  shell: {
    minHeight: '100vh',
    backgroundColor: colours.page,
    color: colours.text,
    fontFamily: 'system-ui, sans-serif',
    fontSize: 16,
    lineHeight: 1.6,
  },
  // Out of sight until the keyboard reaches it, as the first thing on the page.
  skip: {
    position: 'absolute',
    zIndex: 3,
    top: 8,
    left: { default: -9999, ':focus': 8 },
    paddingBlock: 8,
    paddingInline: 12,
    borderRadius: 6,
    backgroundColor: colours.accent,
    color: colours.onAccent,
  },
  bar: {
    position: 'sticky',
    top: 0,
    zIndex: 2,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    height: BAR_HEIGHT,
    paddingInline: { default: 24, [NARROW]: 16 },
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: colours.border,
    backgroundColor: colours.page,
  },
  wordmark: {
    fontWeight: 700,
    fontSize: 18,
    color: colours.text,
    textDecoration: 'none',
  },
  barLinks: { display: 'flex', gap: 20 },
  barLink: {
    color: { default: colours.muted, ':hover': colours.text },
    textDecoration: 'none',
  },
  columns: {
    display: 'grid',
    gridTemplateColumns: {
      default: '260px minmax(0, 1fr)',
      [NARROW]: 'minmax(0, 1fr)',
    },
  },
  withHeadings: {
    gridTemplateColumns: {
      default: '260px minmax(0, 1fr) 240px',
      [WITHOUT_HEADINGS]: '260px minmax(0, 1fr)',
      [NARROW]: 'minmax(0, 1fr)',
    },
  },
  sidebar: {
    position: 'sticky',
    top: BAR_HEIGHT,
    alignSelf: 'start',
    display: { default: 'block', [NARROW]: 'none' },
    height: `calc(100vh - ${BAR_HEIGHT}px)`,
    overflowY: 'auto',
    paddingBlock: 24,
    paddingInline: 20,
    borderRightWidth: 1,
    borderRightStyle: 'solid',
    borderRightColor: colours.border,
  },
  menu: {
    display: { default: 'none', [NARROW]: 'block' },
    marginBottom: 24,
    paddingBlock: 12,
    paddingInline: 16,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colours.border,
    borderRadius: 8,
  },
  menuLabel: { cursor: 'pointer', fontWeight: 600 },
  section: { marginBottom: 24 },
  sectionLabel: {
    marginTop: 0,
    marginBottom: 8,
    color: colours.muted,
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },
  pages: { margin: 0, padding: 0, listStyle: 'none' },
  pageLink: {
    display: 'block',
    paddingBlock: 4,
    color: { default: colours.muted, ':hover': colours.text },
    textDecoration: 'none',
  },
  current: { color: colours.accent },
  main: {
    minWidth: 0,
    maxWidth: 800,
    paddingBlock: { default: 40, [NARROW]: 24 },
    paddingInline: { default: 48, [NARROW]: 16 },
  },
  neighbours: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 16,
    marginTop: 64,
    paddingTop: 24,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: colours.border,
  },
  neighbour: { display: 'grid', color: colours.text, textDecoration: 'none' },
  next: { marginLeft: 'auto', textAlign: 'right' },
  neighbourLabel: { color: colours.muted, fontSize: 14 },
  headings: {
    position: 'sticky',
    top: BAR_HEIGHT,
    alignSelf: 'start',
    display: { default: 'block', [WITHOUT_HEADINGS]: 'none' },
    paddingBlock: 40,
    paddingInline: 20,
  },
  heading: {
    display: 'block',
    paddingBlock: 3,
    color: { default: colours.muted, ':hover': colours.text },
    fontSize: 14,
    textDecoration: 'none',
  },
  h3: { paddingLeft: 12 },
  h4: { paddingLeft: 24 },
});

/** The documentation's shell around `page`, at the URL `model` is at. */
export const view = (model: Model, page: DocsPage, h: HtmlBuilder<Message>): Html => {
  const pathname = model.url.pathname;
  const hasHeadings = Array.isReadonlyArrayNonEmpty(page.tableOfContents);

  const pageLink = ({ label, href }: NavPage): Html =>
    h.li(
      [],
      [
        h.a(
          [
            h.Href(href),
            ...(href === pathname ? [h.AriaCurrent('page')] : []),
            ...Styled.attributes(h, styles.pageLink, href === pathname && styles.current),
          ],
          [label],
        ),
      ],
    );

  const sectionView = ({ label, pages }: DocsSection): Html =>
    h.div(Styled.attributes(h, styles.section), [
      h.h2(Styled.attributes(h, styles.sectionLabel), [label]),
      h.ul(Styled.attributes(h, styles.pages), pages.map(pageLink)),
    ]);

  const navigation = (label: string): Html =>
    h.nav([h.AriaLabel(label)], listedSections(docsSections).map(sectionView));

  const neighbour = (
    maybePage: Option.Option<NavPage>,
    direction: string,
    style: Styled.Style,
  ): ReadonlyArray<Html> =>
    Option.match(maybePage, {
      onNone: () => [],
      onSome: ({ label, href }) => [
        h.a(
          [h.Href(href), ...Styled.attributes(h, styles.neighbour, style)],
          [h.span(Styled.attributes(h, styles.neighbourLabel), [direction]), label],
        ),
      ],
    });

  const { maybePrevious, maybeNext } = neighboursOf(docsSections, pathname);

  return h.div(Styled.attributes(h, styles.shell), [
    h.a([h.Href(`#${CONTENT_ID}`), ...Styled.attributes(h, styles.skip)], ['Skip to content']),
    h.header(Styled.attributes(h, styles.bar), [
      h.a([h.Href(homeRouter()), ...Styled.attributes(h, styles.wordmark)], ['Nitida']),
      h.nav(
        [h.AriaLabel('Elsewhere'), ...Styled.attributes(h, styles.barLinks)],
        [
          h.a(
            [
              h.Href(REPOSITORY),
              h.Target('_blank'),
              h.Rel('noreferrer'),
              ...Styled.attributes(h, styles.barLink),
            ],
            ['GitHub'],
          ),
          h.a(
            [
              h.Href(DISCORD),
              h.Target('_blank'),
              h.Rel('noreferrer'),
              ...Styled.attributes(h, styles.barLink),
            ],
            ['Discord'],
          ),
        ],
      ),
    ]),
    h.div(Styled.attributes(h, styles.columns, hasHeadings && styles.withHeadings), [
      h.aside(Styled.attributes(h, styles.sidebar), [navigation('Documentation')]),
      h.main(
        [h.Id(CONTENT_ID), ...Styled.attributes(h, styles.main)],
        [
          h.details(Styled.attributes(h, styles.menu), [
            h.summary(Styled.attributes(h, styles.menuLabel), ['Menu']),
            navigation('Documentation menu'),
          ]),
          page.content,
          // Drawn only where there is a page to go to, so a page outside the navigation ends with itself.
          ...(Option.isSome(maybePrevious) || Option.isSome(maybeNext)
            ? [
                h.nav(
                  [
                    h.AriaLabel('Pages before and after'),
                    ...Styled.attributes(h, styles.neighbours),
                  ],
                  [
                    ...neighbour(maybePrevious, 'Previous', null),
                    ...neighbour(maybeNext, 'Next', styles.next),
                  ],
                ),
              ]
            : []),
        ],
      ),
      ...(hasHeadings
        ? [
            h.aside(Styled.attributes(h, styles.headings), [
              h.h2(Styled.attributes(h, styles.sectionLabel), ['On this page']),
              h.nav(
                [h.AriaLabel('On this page')],
                page.tableOfContents.map(({ id, text, level }) =>
                  h.a(
                    [
                      h.Href(`#${id}`),
                      ...Styled.attributes(
                        h,
                        styles.heading,
                        level === 'h3' && styles.h3,
                        level === 'h4' && styles.h4,
                      ),
                    ],
                    [text],
                  ),
                ),
              ),
            ]),
          ]
        : []),
    ]),
  ]);
};
