import { Effect, Option, Schema } from 'effect';
import { type HttpServerRequest, HttpServerResponse } from 'effect/http';

/**
 * The best score, as the scores Worker keeps it: every score saved marked by a key of its own in a store written and listed by key, as Cloudflare KV is, and the best read as the first of them. Saved by a POST of a score from a page anywhere, which is answered with the best kept so far. As no save reads before it writes, two saves at the same moment never lose the higher; and as a score is never more than `MOST`, the keys never number more than its scores. What it keeps them in is the Worker's binding to say, or a set in memory in a test.
 */

/** Where scores are marked: written by key, and listed in the order of their keys, as Cloudflare KV is. */
export interface Store<E, R> {
  /** Marks `key` as kept; marking it again changes nothing. */
  readonly mark: (key: string) => Effect.Effect<void, E, R>;
  /** The first key kept that starts with `prefix`, in the order of keys, if any is. */
  readonly first: (prefix: string) => Effect.Effect<Option.Option<string>, E, R>;
}

/** The most a round could score, and so the most a page may save: a cap on what anyone may post, as the Worker trusts no page. */
export const MOST = 999;

/** The prefix every score's key starts with. */
const PREFIX = 'score:';

/** The key `score` is marked by: what it falls short of the most, written to a width, so the first key in order is the best score's. */
const keyOf = (score: number) =>
  `${PREFIX}${String(MOST - score).padStart(String(MOST).length, '0')}`;

/** A score as its key tells it, if the key is one. */
const Shortfall = Schema.NumberFromString.pipe(Schema.check(Schema.isInt()));

/** Keeps `score`, and tells the best kept so far, this one included. */
export const keep = <E, R>(store: Store<E, R>, score: number): Effect.Effect<number, E, R> =>
  Effect.gen(function* () {
    yield* store.mark(keyOf(score));
    const first = yield* store.first(PREFIX);
    const kept = Option.flatMap(first, (key) =>
      Schema.decodeOption(Shortfall)(key.slice(PREFIX.length)).pipe(
        Option.map((shortfall) => MOST - shortfall),
      ),
    );
    // A store listed apart from where it was written may not list this score yet.
    return Option.match(kept, { onNone: () => score, onSome: (best) => Math.max(best, score) });
  });

/** What a page posts: the score of a round. */
const Saved = Schema.Struct({
  score: Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 0, maximum: MOST }))),
});

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
            HttpServerResponse.text(
              `A score is a whole number from 0 to ${MOST}: { "score": 12 }.`,
              {
                status: 400,
                headers: CORS,
              },
            ),
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
