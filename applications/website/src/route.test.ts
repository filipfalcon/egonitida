import { describe, expect, it } from '@effect/vitest';
import { Option } from 'effect';
import * as Url from 'foldkit/url';
import * as Route from '#src/route.ts';

const SITE = 'https://egonitida.com';

/** The route `path` of the site leads to. */
const routeAt = (path: string) =>
  Route.urlToAppRoute(Option.getOrThrow(Url.fromString(`${SITE}${path}`)));

describe('the routes', () => {
  it('leads the root of the site to the home page, and builds the root back from it', () => {
    expect(routeAt('/')).toEqual(Route.AppRoute.Home());
    expect(Route.routeToUrlPath(Route.AppRoute.Home())).toBe('/');
  });

  it('leads /welcome to the welcome, and builds it back', () => {
    expect(routeAt('/welcome')).toEqual(Route.AppRoute.Welcome());
    expect(Route.routeToUrlPath(Route.AppRoute.Welcome())).toBe('/welcome');
  });

  it('leads /installation to the installation, and builds it back', () => {
    expect(routeAt('/installation')).toEqual(Route.AppRoute.Installation());
    expect(Route.routeToUrlPath(Route.AppRoute.Installation())).toBe('/installation');
  });

  it('leads /foundation to the foundation, and builds it back', () => {
    expect(routeAt('/foundation')).toEqual(Route.AppRoute.Foundation());
    expect(Route.routeToUrlPath(Route.AppRoute.Foundation())).toBe('/foundation');
  });

  it('leads /key-terms to the key terms, and builds it back', () => {
    expect(routeAt('/key-terms')).toEqual(Route.AppRoute.KeyTerms());
    expect(Route.routeToUrlPath(Route.AppRoute.KeyTerms())).toBe('/key-terms');
  });

  it('leads /principles to the principles, and builds it back', () => {
    expect(routeAt('/principles')).toEqual(Route.AppRoute.Principles());
    expect(Route.routeToUrlPath(Route.AppRoute.Principles())).toBe('/principles');
  });

  it('leads /architecture to the architecture, and builds it back', () => {
    expect(routeAt('/architecture')).toEqual(Route.AppRoute.Architecture());
    expect(Route.routeToUrlPath(Route.AppRoute.Architecture())).toBe('/architecture');
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
    expect(Route.isDocsRoute(routeAt('/architecture'))).toBe(true);
    expect(Route.isDocsRoute(routeAt('/principles'))).toBe(true);
    expect(Route.isDocsRoute(routeAt('/foundation'))).toBe(true);
    expect(Route.isDocsRoute(routeAt('/key-terms'))).toBe(true);
    expect(Route.isDocsRoute(routeAt('/installation'))).toBe(true);
    expect(Route.isDocsRoute(routeAt('/welcome'))).toBe(true);
    expect(Route.isDocsRoute(routeAt('/'))).toBe(false);
  });
});
