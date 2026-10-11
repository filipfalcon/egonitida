import { Styled } from '@lightocean/foldkit';
import * as stylex from '@stylexjs/stylex';
import type { Html, HtmlBuilder } from 'foldkit/html';
import type { Message } from '#src/main.ts';
import { homeRouter } from '#src/route.ts';
// Relative, as StyleX finds variables by the path of the module that defines them.
import { colours } from '../tokens.stylex.ts';

const styles = stylex.create({
  title: { marginTop: 0, fontSize: 36, lineHeight: 1.2 },
  text: { color: colours.muted },
  link: { color: colours.accent },
});

/** A page that is not found: the path asked for, and the way back home. */
export const view = (path: string, h: HtmlBuilder<Message>): Html =>
  h.div(
    [],
    [
      h.h1(Styled.attributes(h, styles.title), ['Page not found']),
      h.p(Styled.attributes(h, styles.text), [`Nothing is at ${path}.`]),
      h.a([h.Href(homeRouter()), ...Styled.attributes(h, styles.link)], ['Go to the home page']),
    ],
  );
