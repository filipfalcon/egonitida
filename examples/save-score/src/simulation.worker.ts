import { BrowserWorkerRunner } from '@effect/platform-browser';
import { Host, WorkerTransport, World } from '@lightocean/core';
import { Beside } from '@lightocean/devtools';
import { Effect, Layer } from 'effect';
import { FetchHttpClient } from 'effect/http';
import * as Score from '#src/score.ts';
import * as Scores from '#src/scores.ts';

// The local server: the round, stepped off the main thread, its scores saved by the scores Worker, which `alchemy dev` serves locally unless VITE_SCORES_URL says where. A page that joins is whoever plays: an entity that holds nothing, whom its clicks are from. In development it goes on from the world kept for the tab whatever code changed, with the devtools beside it, by the id the page named this worker with.

/** Where the scores Worker is: as configured, or where `alchemy dev` serves it. */
const configured: unknown = import.meta.env['VITE_SCORES_URL'];
const scoresUrl = typeof configured === 'string' ? configured : 'http://127.0.0.1:5490/scores';

const options: Host.Options<Scores.Scores> = {
  game: Score.game,
  join: (world: World.World) => World.spawn(world, []),
  leave: World.despawn,
  world: Score.world,
  mayHold: true,
};

Effect.runFork(
  (import.meta.env.DEV
    ? Beside.host(
        options,
        { name: 'save-score', id: self.name, kept: import.meta.hot?.data },
        (hosted) => WorkerTransport.serveHost(hosted),
      )
    : Effect.flatMap(Host.make(options), WorkerTransport.serveHost)
  ).pipe(
    Effect.catchTag('Unreadable', ({ reason }) =>
      Effect.andThen(
        Effect.logWarning(`The new build cannot take up the round, so it starts over: ${reason}`),
        Effect.sync(() => import.meta.hot?.invalidate(reason)),
      ),
    ),
    Effect.provide(
      Layer.mergeAll(
        Scores.http(scoresUrl).pipe(Layer.provide(FetchHttpClient.layer)),
        BrowserWorkerRunner.layer,
      ),
    ),
    Effect.scoped,
  ),
);

import.meta.hot?.accept();
