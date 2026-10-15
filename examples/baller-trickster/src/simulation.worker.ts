import { BrowserWorkerRunner } from '@effect/platform-browser';
import { Host, State, WorkerTransport } from '@egonitida/core';
import { Beside } from '@egonitida/devtools';
import { Effect } from 'effect';
import { build } from 'virtual:egonitida/build';
import * as Baller from '#src/baller.ts';

// The local server: the baller's game, stepped off the main thread, with a baller for every page that joins. In development the devtools run beside it, by the id the page named this worker with, so a tool on this machine can read, step, and play it; it goes on from the state kept for the tab, and a build that cannot take that state up starts afresh, saying why.
const options = {
  game: Baller.game,
  state: Baller.state,
  join: Baller.join,
  leave: State.despawn,
  maySuspend: true,
  build,
};

Effect.runFork(
  (import.meta.env.DEV
    ? Beside.host(
        options,
        { name: 'baller-trickster', id: self.name, kept: import.meta.hot?.data },
        WorkerTransport.serveHost,
      )
    : Effect.flatMap(Host.make(options), WorkerTransport.serveHost)
  ).pipe(
    Effect.catchTag('Unreadable', ({ reason }) =>
      Effect.andThen(
        Effect.logWarning(
          `The new build cannot take up the baller's state, so it starts over: ${reason}`,
        ),
        Effect.sync(() => import.meta.hot?.invalidate(reason)),
      ),
    ),
    Effect.provide(BrowserWorkerRunner.layer),
    Effect.scoped,
  ),
);

import.meta.hot?.accept();
