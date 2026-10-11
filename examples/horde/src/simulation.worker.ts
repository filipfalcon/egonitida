import { BrowserWorkerRunner } from '@effect/platform-browser';
import { Host, WorkerTransport, World } from '@lightocean/core';
import { Replay } from '@lightocean/devtools';
import { Effect } from 'effect';
import * as Game from '#src/game.ts';
import * as Survivor from '#src/survivor.ts';

// The local server: the arena stepped off the main thread, with a survivor for every page that joins. In development the game is replayed beside it, and the first step where the replay comes apart from it is reported.
const setup = { game: Game.game, join: Survivor.join, leave: World.despawn };

Effect.runFork(
  Effect.gen(function* () {
    const host = yield* Host.make({ ...setup, world: Game.world, mayHold: true });
    if (import.meta.env.DEV) {
      yield* Replay.alongside(host, setup).pipe(
        Effect.flatMap((divergence) =>
          Effect.logError('The horde does not replay as it was played', divergence),
        ),
        Effect.catch((unreadable) => Effect.logError('The horde cannot be replayed', unreadable)),
        Effect.forkScoped,
      );
    }
    yield* WorkerTransport.serveHost(host);
  }).pipe(Effect.provide(BrowserWorkerRunner.layer), Effect.scoped),
);
