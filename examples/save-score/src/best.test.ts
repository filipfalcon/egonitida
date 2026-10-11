import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { HttpServerRequest, HttpServerResponse } from 'effect/http';
import * as Best from '#src/best.ts';

/** A store in memory, read and written as Cloudflare KV is. */
const inMemory = () => {
  const kept = new Map<string, string>();
  const store: Best.Store<never, never> = {
    get: (key) => Effect.sync(() => Option.fromNullishOr(kept.get(key))),
    put: (key, value) =>
      Effect.sync(() => {
        kept.set(key, value);
      }),
  };
  return { kept, store };
};

/** What the scores Worker answers `request` with, as a Fetch response. */
const answer = (store: Best.Store<never, never>, request: Request) =>
  Best.respond(store)(HttpServerRequest.fromWeb(request)).pipe(
    Effect.map((response) => HttpServerResponse.toWeb(response)),
  );

describe('the best score', () => {
  it.effect('is the first score saved, then the highest of those saved', () =>
    Effect.gen(function* () {
      const { kept, store } = inMemory();

      const bests = [
        yield* Best.keep(store, 4),
        yield* Best.keep(store, 9),
        yield* Best.keep(store, 6),
      ];

      expect(bests).toEqual([4, 9, 9]);
      expect(kept.get('best')).toBe('9');
    }),
  );

  it.effect(
    'is saved by a POST of the score, which is answered with the best, to a page from anywhere',
    () =>
      Effect.gen(function* () {
        const { store } = inMemory();
        yield* Best.keep(store, 5);

        const response = yield* answer(
          store,
          new Request('http://scores.test/scores', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ score: 3 }),
          }),
        );

        expect(response.status).toBe(200);
        expect(response.headers.get('access-control-allow-origin')).toBe('*');
        expect(yield* Effect.promise(() => response.json())).toEqual({ best: 5 });
      }),
  );

  it.effect('lets a page ask first whether it may post, and refuses what is no score', () =>
    Effect.gen(function* () {
      const { store } = inMemory();

      const preflight = yield* answer(
        store,
        new Request('http://scores.test/scores', { method: 'OPTIONS' }),
      );
      const refused = yield* answer(
        store,
        new Request('http://scores.test/scores', { method: 'POST', body: '{"score":"many"}' }),
      );

      expect(preflight.status).toBe(204);
      expect(preflight.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS');
      expect(refused.status).toBe(400);
    }),
  );
});
