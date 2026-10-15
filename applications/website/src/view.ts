import type { Document, HtmlBuilder } from 'foldkit/html';
import { Docs } from '#src/layout/index.ts';
import type { Message, Model } from '#src/main.ts';
import {
  Architecture,
  Foundation,
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
    Home: () => ({ title: 'EgoNitida', body: Home.view(model, h) }),
    Welcome: () => ({
      title: 'Welcome · EgoNitida',
      body: Docs.view(model, Welcome, h),
    }),
    Installation: () => ({
      title: 'Installation · EgoNitida',
      body: Docs.view(model, Installation, h),
    }),
    Foundation: () => ({
      title: 'Foundation · EgoNitida',
      body: Docs.view(model, Foundation, h),
    }),
    KeyTerms: () => ({
      title: 'Key Terms · EgoNitida',
      body: Docs.view(model, KeyTerms.view(model, h), h),
    }),
    Principles: () => ({
      title: 'Principles · EgoNitida',
      body: Docs.view(model, Principles, h),
    }),
    Architecture: () => ({
      title: 'Architecture · EgoNitida',
      body: Docs.view(model, Architecture, h),
    }),
    NotFound: ({ path }) => ({
      title: 'Page not found · EgoNitida',
      body: Docs.view(model, { content: NotFound.view(path, h), tableOfContents: [] }, h),
    }),
  });
