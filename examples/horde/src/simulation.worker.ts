import { BrowserWorkerRunner } from '@effect/platform-browser';
import { WorkerTransport, World } from '@lightocean/core';
import { Reload, Replay, Rewind } from '@lightocean/devtools';
import { Effect } from 'effect';
import * as Game from '#src/game.ts';
import * as Survivor from '#src/survivor.ts';

// The local server: the arena stepped off the main thread, with a survivor for every page that joins. In development the game is replayed beside it, and the first step where the replay comes apart from it is reported; the last thirty seconds are kept, for the page to go back in; and when the game's code changes, this module runs again and hands the host the new build, which plays on from the world it was at. A build that cannot take that world up reloads the page, and the game starts over.
const setup = { game: Game.game, join: Survivor.join, leave: World.despawn };

Effect.runFork(
  Reload.host(import.meta.hot?.data, { ...setup, world: Game.world, mayHold: true }, (host) =>
    Effect.gen(function* () {
      if (import.meta.env.DEV) {
        yield* Replay.alongside(host, setup).pipe(
          Effect.flatMap((divergence) =>
            Effect.logError('The horde does not replay as it was played', divergence),
          ),
          Effect.catch((unreadable) => Effect.logError('The horde cannot be replayed', unreadable)),
          Effect.forkScoped,
        );
        yield* Rewind.serve(host, yield* Rewind.make(host, setup, { every: 30, keepSeconds: 30 }));
      }
      yield* WorkerTransport.serveHost(host);
    }),
  ).pipe(
    Effect.catchTag('Unreadable', ({ reason }) =>
      Effect.andThen(
        Effect.logWarning(
          `The new build cannot take up the horde's world, so it starts over: ${reason}`,
        ),
        Effect.sync(() => import.meta.hot?.invalidate(reason)),
      ),
    ),
    Effect.provide(BrowserWorkerRunner.layer),
    Effect.scoped,
  ),
);

import.meta.hot?.accept();
