import { BrowserWorkerRunner } from '@effect/platform-browser';
import { Host, WorkerTransport, State } from '@lightocean/core';
import { Beside } from '@lightocean/devtools';
import { Effect } from 'effect';
import * as Ocean from '#src/ocean.ts';

// The local server: the ocean, stepped off the main thread. A page that joins is whoever clicks the lights: an entity that holds nothing, whom its clicks are from. In development it goes on from the state kept for the tab whatever code changed, with the devtools beside it, by the id the page named this worker with.
const options = {
  game: Ocean.game,
  join: (state: State.State) => State.spawn(state, []),
  leave: State.despawn,
  state: Ocean.state,
  maySuspend: true,
};

Effect.runFork(
  (import.meta.env.DEV
    ? Beside.host(
        options,
        { name: 'website', id: self.name, kept: import.meta.hot?.data },
        WorkerTransport.serveHost,
      )
    : Effect.flatMap(Host.make(options), WorkerTransport.serveHost)
  ).pipe(
    Effect.catchTag('Unreadable', ({ reason }) =>
      Effect.andThen(
        Effect.logWarning(`The new build cannot take up the ocean, so it starts over: ${reason}`),
        Effect.sync(() => import.meta.hot?.invalidate(reason)),
      ),
    ),
    Effect.provide(BrowserWorkerRunner.layer),
    Effect.scoped,
  ),
);

import.meta.hot?.accept();
