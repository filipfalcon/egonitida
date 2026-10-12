import { BrowserWorkerRunner } from '@effect/platform-browser';
import { Host, WorkerTransport, State } from '@lightocean/core';
import { Beside } from '@lightocean/devtools';
import { Effect } from 'effect';
import * as Editing from '#src/editing.ts';

// The local server: the document being edited, a state stepped off the main thread. A page that joins is an editor, whose edits are its actions. In development it goes on from the document kept for the tab whatever code changed, with the devtools beside it, by the id the page named this worker with.
const options = {
  game: Editing.game,
  join: Editing.join,
  leave: State.despawn,
  state: Editing.document,
  maySuspend: true,
};

Effect.runFork(
  (import.meta.env.DEV
    ? Beside.host(
        options,
        { name: 'editor', id: self.name, kept: import.meta.hot?.data },
        WorkerTransport.serveHost,
      )
    : Effect.flatMap(Host.make(options), WorkerTransport.serveHost)
  ).pipe(
    Effect.catchTag('Unreadable', ({ reason }) =>
      Effect.andThen(
        Effect.logWarning(
          `The new build cannot take up the document, so it starts over: ${reason}`,
        ),
        Effect.sync(() => import.meta.hot?.invalidate(reason)),
      ),
    ),
    Effect.provide(BrowserWorkerRunner.layer),
    Effect.scoped,
  ),
);

import.meta.hot?.accept();
