import * as Cloudflare from 'alchemy/Cloudflare';
import { Effect, Option } from 'effect';
import { HttpServerRequest } from 'effect/http/HttpServerRequest';
import * as Best from '#src/best.ts';

// The scores Worker: keeps every score in a Cloudflare KV namespace bound to it, by a key of its own, and answers a page's POST of a score with the best kept so far. Under `alchemy dev` it serves on a port of its own, its KV kept locally.

/** The KV namespace the best score is kept in, declared apart from the Worker, so the stack makes it before the Worker that binds it. */
export const ScoresKV = Cloudflare.KV.Namespace('BestScores');

/** The scores Worker: where the save-score example's pages save their scores, so the best outlasts every page and is the same for all of them. */
export default class ScoresWorker extends Cloudflare.Worker<ScoresWorker>()(
  'Scores',
  { main: import.meta.url, dev: { port: 5490, strictPort: true } },
  Effect.gen(function* () {
    const kv = yield* Cloudflare.KV.ReadWriteNamespace(yield* ScoresKV);
    const respond = Best.respond({
      // A score's key is all it keeps, so its value is empty.
      mark: (key) => kv.put(key, ''),
      // KV lists keys in their order, so the first of one is the first of all.
      first: (prefix) =>
        Effect.map(kv.list({ prefix, limit: 1 }), ({ keys }) =>
          Option.map(Option.fromNullishOr(keys[0]), ({ name }) => name),
        ),
    });

    return {
      fetch: Effect.flatMap(HttpServerRequest, respond),
    };
  }).pipe(Effect.provide(Cloudflare.KV.ReadWriteNamespaceBinding)),
) {}
