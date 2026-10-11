import type { Document, HtmlBuilder } from 'foldkit/html';
import type { Message, Model } from '#src/main.ts';
import { Home, NotFound } from '#src/page/index.ts';
import { AppRoute } from '#src/route.ts';

/** The website as its route has it: the page the URL leads to, under that page's title. */
export const view = (model: Model, h: HtmlBuilder<Message>): Document =>
  AppRoute.match(model.route, {
    Home: () => ({ title: 'LightOcean', body: Home.view(model, h) }),
    NotFound: ({ path }) => ({
      title: 'Page not found · LightOcean',
      body: NotFound.view(path, h),
    }),
  });
