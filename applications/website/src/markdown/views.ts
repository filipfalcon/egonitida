import type * as Markdown from '@foldkit/markdown';
import { Styled } from '@nitida/foldkit';
import * as stylex from '@stylexjs/stylex';
import { Match, Option } from 'effect';
import { type Html, inertHtml as h } from 'foldkit/html';
import { type HeadingIds, headingId } from '#src/markdown/tableOfContents.ts';
import { parseHeadingId, stripHeadingIdMarker } from '#src/markdown/slug.ts';
// Relative, as StyleX finds variables by the path of the module that defines them.
import { colours } from '../tokens.stylex.ts';

const MONOSPACE = 'ui-monospace, SFMono-Regular, Menlo, monospace';

const styles = stylex.create({
  title: {
    marginTop: 0,
    marginBottom: 24,
    fontSize: 40,
    lineHeight: 1.15,
    letterSpacing: '0.01em',
    textTransform: 'uppercase',
  },
  // Clear of the bar over the page when a link leads to it; every heading in capitals.
  heading: { scrollMarginTop: 88, lineHeight: 1.3, textTransform: 'uppercase' },
  h2: { marginTop: 48, marginBottom: 16, fontSize: 28 },
  h3: { marginTop: 32, marginBottom: 12, fontSize: 21 },
  h4: { marginTop: 24, marginBottom: 8, fontSize: 18 },
  paragraph: { marginTop: 0, marginBottom: 16 },
  link: { color: colours.accent },
  inlineCode: {
    paddingBlock: 1,
    paddingInline: 5,
    borderRadius: 4,
    backgroundColor: colours.surface,
    fontFamily: MONOSPACE,
    fontSize: '0.88em',
  },
  codeBlock: {
    marginTop: 0,
    marginBottom: 20,
    padding: 18,
    overflowX: 'auto',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colours.border,
    borderRadius: 8,
    backgroundColor: colours.code,
    fontFamily: MONOSPACE,
    fontSize: 14,
    lineHeight: 1.55,
  },
  blockquote: {
    marginInline: 0,
    marginBottom: 20,
    paddingInline: 16,
    borderLeftWidth: 3,
    borderLeftStyle: 'solid',
    borderLeftColor: colours.border,
    color: colours.muted,
  },
  rule: {
    marginBlock: 40,
    borderWidth: 0,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: colours.border,
  },
  tableScroll: { marginBottom: 20, overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse' },
  cell: {
    paddingBlock: 8,
    paddingInline: 12,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: colours.border,
    textAlign: 'left',
    verticalAlign: 'top',
  },
  headerCell: { fontWeight: 600 },
  center: { textAlign: 'center' },
  right: { textAlign: 'right' },
});

/** The style a column's alignment gives its cells. */
const alignmentStyle = (alignment: Markdown.Alignment): Styled.Style =>
  Match.value(alignment).pipe(
    Match.withReturnType<Styled.Style>(),
    Match.when('Center', () => styles.center),
    Match.when('Right', () => styles.right),
    Match.orElse(() => null),
  );

/** How a page of the documentation draws its markdown: in the website's styles, every heading under the id its table of contents reaches it by. */
export const docViews = (idByHeading: HeadingIds): Partial<Markdown.Views> => ({
  Heading: (heading, content) => {
    const shown = Option.isSome(parseHeadingId(heading.content).maybeId)
      ? stripHeadingIdMarker(content)
      : content;
    const attributes = (style: Styled.Style) => [
      h.Id(headingId(idByHeading, heading)),
      ...Styled.attributes(h, styles.heading, style),
    ];
    return Match.value(heading.level).pipe(
      Match.withReturnType<Html>(),
      Match.when(1, () => h.h1(Styled.attributes(h, styles.title), shown)),
      Match.when(2, () => h.h2(attributes(styles.h2), shown)),
      Match.when(3, () => h.h3(attributes(styles.h3), shown)),
      Match.when(4, () => h.h4(attributes(styles.h4), shown)),
      Match.when(5, () => h.h5(attributes(null), shown)),
      Match.orElse(() => h.h6(attributes(null), shown)),
    );
  },
  Paragraph: (_paragraph, content) => h.p(Styled.attributes(h, styles.paragraph), content),
  Link: ({ url }, content) => h.a([h.Href(url), ...Styled.attributes(h, styles.link)], content),
  InlineCode: ({ value }) => h.code(Styled.attributes(h, styles.inlineCode), [value]),
  CodeBlock: ({ value }) =>
    h.pre(Styled.attributes(h, styles.codeBlock), [h.code([], [value.trimEnd()])]),
  Blockquote: (_blockquote, blocks) =>
    h.blockquote(Styled.attributes(h, styles.blockquote), blocks),
  ThematicBreak: () => h.hr(Styled.attributes(h, styles.rule)),
  // Wider than the page, a table scrolls within its own width rather than the page's.
  Table: (_table, headerRow, bodyRows) =>
    h.div(Styled.attributes(h, styles.tableScroll), [
      h.table(Styled.attributes(h, styles.table), [
        h.thead([], [headerRow]),
        h.tbody([], bodyRows),
      ]),
    ]),
  TableCell: (_cell, content, alignment, isHeader) =>
    isHeader
      ? h.th(
          Styled.attributes(h, styles.cell, styles.headerCell, alignmentStyle(alignment)),
          content,
        )
      : h.td(Styled.attributes(h, styles.cell, alignmentStyle(alignment)), content),
});
