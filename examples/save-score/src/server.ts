import * as Cloudflare from 'alchemy/Cloudflare';
import { Effect } from 'effect';
import { HttpServerRequest } from 'effect/http/HttpServerRequest';
import * as Best from '#src/best.ts';

// The scores Worker: keeps the best score in a Cloudflare KV namespace bound to it, and answers a page's POST of a score with the best kept so far. Under `alchemy dev` it serves on a port of its own, its KV kept locally.

export default class ScoresWorker extends Cloudflare.Worker<ScoresWorker>()(
  'Scores',
  { main: import.meta.url, dev: { port: 5490, strictPort: true } },
  Effect.gen(function* () {
    const namespace = yield* Cloudflare.KV.Namespace('Scores');
    const kv = yield* Cloudflare.KV.ReadWriteNamespace(namespace);
    const respond = Best.respond({
      get: (key) => kv.get(key),
      put: (key, value) => kv.put(key, value),
    });

    return {
      fetch: Effect.flatMap(HttpServerRequest, respond),
    };
  }).pipe(Effect.provide(Cloudflare.KV.ReadWriteNamespaceBinding)),
) {}
