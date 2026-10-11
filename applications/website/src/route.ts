import { Schema, pipe } from 'effect';
import { defineRouteUnion, mapTo, oneOf, parseUrlWithFallback, root } from 'foldkit/route';

/**
 * The website's routes: every page it has, each read off a URL and built back into one by the same router. A page of the documentation is a route of its own, added here, to `DocsRoute`, and to the documentation's navigation in `docsNav.ts`.
 */

/** Every page of the website: the home page, the pages of the documentation, and a page that is not found, which keeps the path asked for. */
export const AppRoute = defineRouteUnion({
  Home: {},
  NotFound: { path: Schema.String },
});
export type AppRoute = typeof AppRoute.Type;

/** The pages drawn inside the documentation, with its navigation beside them. A page that is not found is one, so a mistyped address still leads somewhere to go on from. */
export const DocsRoute = AppRoute.subset(['NotFound']);
export type DocsRoute = typeof DocsRoute.Type;

/** Whether `route` is drawn inside the documentation. */
export const isDocsRoute = Schema.is(DocsRoute);

// ROUTERS

/** The root of the site, the home page. */
export const homeRouter = pipe(root, mapTo(AppRoute.Home));

const routeParser = oneOf(homeRouter);

/** The route a URL leads to: a page that is not found where no router reads it. */
export const urlToAppRoute = parseUrlWithFallback(routeParser, AppRoute.NotFound);

/** The path of the URL that leads to `route`. */
export const routeToUrlPath = (route: AppRoute): string =>
  AppRoute.match(route, {
    Home: () => homeRouter(),
    NotFound: ({ path }) => path,
  });
