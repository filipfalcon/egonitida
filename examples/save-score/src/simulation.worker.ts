import { BrowserWorkerRunner } from '@effect/platform-browser';
import { Host, WorkerTransport, State } from '@lightocean/core';
import { Beside } from '@lightocean/devtools';
import { Effect, Layer } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { build } from 'virtual:lightocean/build';
import * as Score from '#src/score.ts';
import * as Scores from '#src/scores.ts';

// The local server: the round, stepped off the main thread, its scores saved by the scores Worker at VITE_SCORES_URL, which the Alchemy stack gives the page. A page that joins is whoever plays: an entity that holds nothing, whom its clicks are from. In development it goes on from the state kept for the tab whatever code changed, with the devtools beside it, by the id the page named this worker with.

/** Where scores are kept, as the Alchemy stack says where the scores Worker is; nowhere, saying so, if it says nothing, as when the page is served without the stack. */
const configured: unknown = import.meta.env['VITE_SCORES_URL'];
const scores =
  typeof configured === 'string' && configured !== ''
    ? Scores.http(new URL('/scores', configured).href).pipe(Layer.provide(FetchHttpClient.layer))
    : Scores.nowhere('The page was not told where scores are kept: serve it with `npm run dev`.');

const options: Host.Options<Scores.Scores> = {
  game: Score.game,
  join: (state: State.State) => State.spawn(state, []),
  leave: State.despawn,
  state: Score.state,
  maySuspend: true,
  build,
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
    Effect.provide(Layer.mergeAll(scores, BrowserWorkerRunner.layer)),
    Effect.scoped,
  ),
);

import.meta.hot?.accept();
