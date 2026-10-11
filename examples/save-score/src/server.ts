import * as Cloudflare from 'alchemy/Cloudflare';
import { Effect, Option } from 'effect';
import { HttpServerRequest } from 'effect/http/HttpServerRequest';
import * as Best from '#src/best.ts';

// The scores Worker: keeps the best score in a Cloudflare KV namespace bound to it, and answers a page's POST of a score with the best kept so far. Under `alchemy dev` it serves on a port of its own, its KV kept locally.

/** The KV namespace the best score is kept in, declared apart from the Worker, so the stack makes it before the Worker that binds it. */
export const ScoresKV = Cloudflare.KV.Namespace('BestScores');

/** The scores Worker. */
export default class ScoresWorker extends Cloudflare.Worker<ScoresWorker>()(
  'Scores',
  { main: import.meta.url, dev: { port: 5490, strictPort: true } },
  Effect.gen(function* () {
    const kv = yield* Cloudflare.KV.ReadWriteNamespace(yield* ScoresKV);
    const respond = Best.respond({
      // KV gives null for a key it does not hold.
      get: (key) => Effect.map(kv.get(key), Option.fromNullishOr),
      put: (key, value) => kv.put(key, value),
    });

    return {
      fetch: Effect.flatMap(HttpServerRequest, respond),
    };
  }).pipe(Effect.provide(Cloudflare.KV.ReadWriteNamespaceBinding)),
) {}
