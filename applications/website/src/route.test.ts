import { describe, expect, it } from '@effect/vitest';
import { Option } from 'effect';
import * as Url from 'foldkit/url';
import * as Route from '#src/route.ts';

const SITE = 'https://lightocean.dev';

/** The route `path` of the site leads to. */
const routeAt = (path: string) =>
  Route.urlToAppRoute(Option.getOrThrow(Url.fromString(`${SITE}${path}`)));

describe('the routes', () => {
  it('leads the root of the site to the home page, and builds the root back from it', () => {
    expect(routeAt('/')).toEqual(Route.AppRoute.Home());
    expect(Route.routeToUrlPath(Route.AppRoute.Home())).toBe('/');
  });

  it('leads any other path to a page that is not found, keeping the path asked for', () => {
    expect(routeAt('/nowhere/at-all')).toEqual(
      Route.AppRoute.NotFound({ path: '/nowhere/at-all' }),
    );
    expect(Route.routeToUrlPath(Route.AppRoute.NotFound({ path: '/nowhere/at-all' }))).toBe(
      '/nowhere/at-all',
    );
  });

  it('draws a page that is not found inside the documentation, and the home page outside it', () => {
    expect(Route.isDocsRoute(routeAt('/nowhere'))).toBe(true);
    expect(Route.isDocsRoute(routeAt('/'))).toBe(false);
  });
});
