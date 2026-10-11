import { BrowserWorkerRunner } from '@effect/platform-browser';
import { WorkerTransport, World } from '@lightocean/core';
import { Beside, Reload } from '@lightocean/devtools';
import { Effect } from 'effect';
import * as Game from '#src/game.ts';
import * as Survivor from '#src/survivor.ts';

// The local server: the arena stepped off the main thread, with a survivor for every page that joins. In development the game is replayed beside it, and the first step where the replay comes apart from it is reported; the last thirty seconds are kept, for the page to go back in, and for an agent to ask after through the development server; and when the game's code changes, this module runs again and hands the host the new build, which plays on from the world it was at. A build that cannot take that world up reloads the page, and the game starts over.
const setup = { game: Game.game, join: Survivor.join, leave: World.despawn };

Effect.runFork(
  Reload.host(import.meta.hot?.data, { ...setup, world: Game.world, mayHold: true }, (host) =>
    Effect.gen(function* () {
      if (import.meta.env.DEV) {
        // The page that started this worker named it by the id the devtools know its host by, so the page can name the host it draws.
        yield* Beside.serve(host, setup, {
          name: 'horde',
          id: self.name === '' ? undefined : self.name,
        });
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
