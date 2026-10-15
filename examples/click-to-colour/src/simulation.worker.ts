import { BrowserWorkerRunner } from '@effect/platform-browser';
import { Host, WorkerTransport, State } from '@egonitida/core';
import { Beside } from '@egonitida/devtools';
import { Effect } from 'effect';
import { build } from 'virtual:egonitida/build';
import * as Colour from '#src/colour.ts';

// The local server: the cubes' game, stepped off the main thread. A page that joins is whoever clicks: an entity that holds nothing, whom its clicks are from. In development it goes on from the state kept for the tab whatever code changed, as the horde's does, with the devtools beside it, by the id the page named this worker with.
const options = {
  game: Colour.game,
  join: (state: State.State) => State.spawn(state, []),
  leave: State.despawn,
  state: Colour.state,
  maySuspend: true,
  build,
};

Effect.runFork(
  (import.meta.env.DEV
    ? Beside.host(
        options,
        { name: 'cubes', id: self.name, kept: import.meta.hot?.data },
        WorkerTransport.serveHost,
      )
    : Effect.flatMap(Host.make(options), WorkerTransport.serveHost)
  ).pipe(
    Effect.catchTag('Unreadable', ({ reason }) =>
      Effect.andThen(
        Effect.logWarning(
          `The new build cannot take up the cubes' state, so it starts over: ${reason}`,
        ),
        Effect.sync(() => import.meta.hot?.invalidate(reason)),
      ),
    ),
    Effect.provide(BrowserWorkerRunner.layer),
    Effect.scoped,
  ),
);

import.meta.hot?.accept();
