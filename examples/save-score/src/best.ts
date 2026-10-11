import { Effect, Option, Schema } from 'effect';
import { type HttpServerRequest, HttpServerResponse } from 'effect/http';

/**
 * The best score, as the scores Worker keeps it: in a store read and written by key, as Cloudflare KV is, and saved by a POST of a score from a page anywhere, which is answered with the best kept so far. What it keeps the best in is the Worker's binding to say, or a map in memory in a test.
 */

/** Where the best is kept: read and written by key, as Cloudflare KV is. */
export interface Store<E, R> {
  readonly get: (key: string) => Effect.Effect<Option.Option<string>, E, R>;
  readonly put: (key: string, value: string) => Effect.Effect<void, E, R>;
}

/** The key the best is kept under. */
const KEY = 'best';

/** A whole number written as text, if it is one. */
const Whole = Schema.NumberFromString.pipe(Schema.check(Schema.isInt()));

/** Keeps `score` if it is the best yet, and tells the best kept so far, this one included. */
export const keep = <E, R>(store: Store<E, R>, score: number): Effect.Effect<number, E, R> =>
  Effect.gen(function* () {
    const kept = Option.flatMap(yield* store.get(KEY), Schema.decodeUnknownOption(Whole));
    const best = Option.match(kept, {
      onNone: () => score,
      onSome: (before) => Math.max(before, score),
    });
    if (!Option.contains(kept, best)) {
      yield* store.put(KEY, String(best));
    }
    return best;
  });

/** What a page posts: the score of a round. */
const Saved = Schema.Struct({ score: Schema.Int });

/** What a page may send from anywhere, as a browser asks before it posts: a score, with the trace headers an Effect HTTP client adds. */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, traceparent, b3',
};

/** Answers a page: a POST of a score with the best kept so far; a browser's asking first with what it may send; anything else, or what is no score, refused. */
export const respond =
  <E, R>(store: Store<E, R>) =>
  (
    request: HttpServerRequest.HttpServerRequest,
  ): Effect.Effect<HttpServerResponse.HttpServerResponse, never, R> => {
    if (request.method === 'OPTIONS') {
      return Effect.succeed(HttpServerResponse.empty({ status: 204, headers: CORS }));
    }
    if (request.method !== 'POST') {
      return Effect.succeed(
        HttpServerResponse.text('Only a POST of a score.', { status: 405, headers: CORS }),
      );
    }
    return request.json.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Saved)),
      Effect.matchEffect({
        onFailure: () =>
          Effect.succeed(
            HttpServerResponse.text('A score is a whole number: { "score": 12 }.', {
              status: 400,
              headers: CORS,
            }),
          ),
        onSuccess: ({ score }) =>
          keep(store, score).pipe(
            Effect.flatMap((best) => HttpServerResponse.json({ best }, { headers: CORS })),
            Effect.orElseSucceed(() =>
              HttpServerResponse.text('The best score could not be kept.', {
                status: 503,
                headers: CORS,
              }),
            ),
          ),
      }),
    );
  };
