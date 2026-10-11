import { BrowserWorkerRunner } from '@effect/platform-browser';
import { Host, WorkerTransport, World } from '@lightocean/core';
import { Replay, Rewind } from '@lightocean/devtools';
import { Effect } from 'effect';
import * as Game from '#src/game.ts';
import * as Survivor from '#src/survivor.ts';

// The local server: the arena stepped off the main thread, with a survivor for every page that joins. In development the game is replayed beside it, and the first step where the replay comes apart from it is reported; and the last thirty seconds are kept, for the page to go back in.
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
      yield* Rewind.serve(host, yield* Rewind.make(host, setup, { every: 30, keepSeconds: 30 }));
    }
    yield* WorkerTransport.serveHost(host);
  }).pipe(Effect.provide(BrowserWorkerRunner.layer), Effect.scoped),
);
