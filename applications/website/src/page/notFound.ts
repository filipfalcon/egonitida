import type { Html, HtmlBuilder } from 'foldkit/html';
import type { Message } from '#src/main.ts';
import { homeRouter } from '#src/route.ts';

/** A page that is not found: the path asked for, and the way back home. */
export const view = (path: string, h: HtmlBuilder<Message>): Html =>
  h.div(
    [],
    [
      h.h1([], ['Page not found']),
      h.p([], [`Nothing is at ${path}.`]),
      h.a([h.Href(homeRouter())], ['Go to the home page']),
    ],
  );
