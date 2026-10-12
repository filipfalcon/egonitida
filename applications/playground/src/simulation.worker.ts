import { BrowserWorkerRunner } from '@effect/platform-browser';
import { Host, WorkerTransport, State } from '@lightocean/core';
import { Beside } from '@lightocean/devtools';
import { Effect } from 'effect';
import * as Cubes from '#src/cubes.ts';

// The local server: the playground's game, stepped off the main thread. A page that joins is whoever asks for cubes and clicks them: an entity that holds nothing, whom its asks and clicks are from. In development it goes on from the state kept for the tab whatever code changed, with the devtools beside it, by the id the page named this worker with.
const options = {
  game: Cubes.game,
  join: (state: State.State) => State.spawn(state, []),
  leave: State.despawn,
  state: Cubes.state,
  mayHold: true,
};

Effect.runFork(
  (import.meta.env.DEV
    ? Beside.host(
        options,
        { name: 'playground', id: self.name, kept: import.meta.hot?.data },
        WorkerTransport.serveHost,
      )
    : Effect.flatMap(Host.make(options), WorkerTransport.serveHost)
  ).pipe(
    Effect.catchTag('Unreadable', ({ reason }) =>
      Effect.andThen(
        Effect.logWarning(
          `The new build cannot take up the playground's state, so it starts over: ${reason}`,
        ),
        Effect.sync(() => import.meta.hot?.invalidate(reason)),
      ),
    ),
    Effect.provide(BrowserWorkerRunner.layer),
    Effect.scoped,
  ),
);

import.meta.hot?.accept();
