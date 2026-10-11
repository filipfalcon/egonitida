import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { HttpServerRequest, HttpServerResponse } from 'effect/http';
import * as Best from '#src/best.ts';

/** A store in memory, written and listed as Cloudflare KV is, which lets other saves run between any two of its steps. */
const inMemory = () => {
  const kept = new Set<string>();
  const store: Best.Store<never, never> = {
    mark: (key) =>
      Effect.andThen(
        Effect.yieldNow,
        Effect.sync(() => {
          kept.add(key);
        }),
      ),
    first: (prefix) =>
      Effect.andThen(
        Effect.yieldNow,
        Effect.sync(() =>
          Option.fromNullishOr([...kept].filter((key) => key.startsWith(prefix)).sort()[0]),
        ),
      ),
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
      expect(kept.size).toBe(3);
    }),
  );

  it.effect('keeps the highest of scores saved at the same moment', () =>
    Effect.gen(function* () {
      const { store } = inMemory();

      yield* Effect.all([Best.keep(store, 9), Best.keep(store, 4)], { concurrency: 'unbounded' });

      expect(yield* Best.keep(store, 1)).toBe(9);
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

  it.effect(
    'lets a page ask first whether it may post, with the headers its client sends, and refuses what is no score',
    () =>
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
        // What the page's HTTP client sends with every post: its JSON, and where its trace goes on.
        expect(preflight.headers.get('access-control-allow-headers')).toBe(
          'content-type, traceparent, b3',
        );
        expect(refused.status).toBe(400);
      }),
  );

  it.effect('refuses a score no round could make: below nothing, or above the most', () =>
    Effect.gen(function* () {
      const { kept, store } = inMemory();
      const post = (score: number) =>
        answer(
          store,
          new Request('http://scores.test/scores', {
            method: 'POST',
            body: JSON.stringify({ score }),
          }),
        );

      const statuses = [(yield* post(-1)).status, (yield* post(Best.MOST + 1)).status];

      expect(statuses).toEqual([400, 400]);
      expect(kept.size).toBe(0);
      expect((yield* post(Best.MOST)).status).toBe(200);
    }),
  );
});
