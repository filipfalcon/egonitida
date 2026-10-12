import type { Document, HtmlBuilder } from 'foldkit/html';
import { Docs } from '#src/layout/index.ts';
import type { Message, Model } from '#src/main.ts';
import {
  Architecture,
  Home,
  Installation,
  KeyTerms,
  NotFound,
  Principles,
  Welcome,
} from '#src/page/index.ts';
import { AppRoute } from '#src/route.ts';

/** The website as its route has it: the page the URL leads to, under that page's title, and a page of the documentation inside its shell. */
export const view = (model: Model, h: HtmlBuilder<Message>): Document =>
  AppRoute.match(model.route, {
    Home: () => ({ title: 'LightOcean', body: Home.view(model, h) }),
    Welcome: () => ({
      title: 'Welcome · LightOcean',
      body: Docs.view(model, Welcome, h),
    }),
    Installation: () => ({
      title: 'Installation · LightOcean',
      body: Docs.view(model, Installation, h),
    }),
    KeyTerms: () => ({
      title: 'Key Terms · LightOcean',
      body: Docs.view(model, KeyTerms.view(model, h), h),
    }),
    Principles: () => ({
      title: 'Principles · LightOcean',
      body: Docs.view(model, Principles, h),
    }),
    Architecture: () => ({
      title: 'Architecture · LightOcean',
      body: Docs.view(model, Architecture, h),
    }),
    NotFound: ({ path }) => ({
      title: 'Page not found · LightOcean',
      body: Docs.view(model, { content: NotFound.view(path, h), tableOfContents: [] }, h),
    }),
  });
