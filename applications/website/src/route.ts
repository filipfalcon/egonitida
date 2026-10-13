import { Schema, pipe } from 'effect';
import { defineRouteUnion, literal, mapTo, oneOf, parseUrlWithFallback, root } from 'foldkit/route';

/**
 * The website's routes: every page it has, each read off a URL and built back into one by the same router. A page of the documentation is a route of its own, added here, to `DocsRoute`, and to the documentation's navigation in `docsNav.ts`.
 */

/** Every page of the website: the home page, the pages of the documentation, and a page that is not found, which keeps the path asked for. */
export const AppRoute = defineRouteUnion({
  Home: {},
  Welcome: {},
  Installation: {},
  Foundation: {},
  KeyTerms: {},
  Principles: {},
  Architecture: {},
  NotFound: { path: Schema.String },
});
export type AppRoute = typeof AppRoute.Type;

/** The pages drawn inside the documentation, with its navigation beside them. A page that is not found is one, so a mistyped address still leads somewhere to go on from. */
export const DocsRoute = AppRoute.subset([
  'Welcome',
  'Installation',
  'Foundation',
  'KeyTerms',
  'Principles',
  'Architecture',
  'NotFound',
]);
export type DocsRoute = typeof DocsRoute.Type;

/** Whether `route` is drawn inside the documentation. */
export const isDocsRoute = Schema.is(DocsRoute);

// ROUTERS

/** The root of the site, the home page. */
export const homeRouter = pipe(root, mapTo(AppRoute.Home));

/** Where the documentation begins. */
export const welcomeRouter = pipe(literal('welcome'), mapTo(AppRoute.Welcome));

/** How to get the engine running. */
export const installationRouter = pipe(literal('installation'), mapTo(AppRoute.Installation));

/** What the whole engine stands on: a state, its input, and the step from one state to the next. */
export const foundationRouter = pipe(literal('foundation'), mapTo(AppRoute.Foundation));

/** The terms the whole engine is told in. */
export const keyTermsRouter = pipe(literal('key-terms'), mapTo(AppRoute.KeyTerms));

/** The principles the engine stands on. */
export const principlesRouter = pipe(literal('principles'), mapTo(AppRoute.Principles));

/** Why the engine is built the way it is. */
export const architectureRouter = pipe(literal('architecture'), mapTo(AppRoute.Architecture));

const routeParser = oneOf(
  homeRouter,
  welcomeRouter,
  installationRouter,
  foundationRouter,
  keyTermsRouter,
  principlesRouter,
  architectureRouter,
);

/** The route a URL leads to: a page that is not found where no router reads it. */
export const urlToAppRoute = parseUrlWithFallback(routeParser, AppRoute.NotFound);

/** The path of the URL that leads to `route`. */
export const routeToUrlPath = (route: AppRoute): string =>
  AppRoute.match(route, {
    Home: () => homeRouter(),
    Welcome: () => welcomeRouter(),
    Installation: () => installationRouter(),
    Foundation: () => foundationRouter(),
    KeyTerms: () => keyTermsRouter(),
    Principles: () => principlesRouter(),
    Architecture: () => architectureRouter(),
    NotFound: ({ path }) => path,
  });
