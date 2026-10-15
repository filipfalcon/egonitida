import { BrowserWorkerRunner } from '@effect/platform-browser';
import { Host, WorkerTransport } from '@egonitida/core';
import { Beside, Debugger } from '@egonitida/devtools';
import { Effect } from 'effect';
import { build } from 'virtual:egonitida/build';
import * as Press from '#src/press.ts';
import * as Stepping from '#src/stepping.ts';

// The press's local server: its game, stepped off the main thread, its time suspended from the start and stepped one step at a page's click. The engine's debugger is always beside it, keeping the past a page goes back to. In development it goes on from the state kept for the tab whatever code changed, with the rest of the devtools beside it too, by the id the page named this worker with.
const options = { ...Press.setup, state: Press.state, maySuspend: true, build };

/** Serves `host` to the page, stepped by hand. */
const serving = (host: Host.Host) =>
  Effect.andThen(Stepping.serve(host), WorkerTransport.serveHost(host));

Effect.runFork(
  (import.meta.env.DEV
    ? Beside.host(options, { name: 'press', id: self.name, kept: import.meta.hot?.data }, serving)
    : Effect.flatMap(Host.make(options), (host) =>
        Effect.andThen(Debugger.serve(host, options), serving(host)),
      )
  ).pipe(
    Effect.catchTag('Unreadable', ({ reason }) =>
      Effect.andThen(
        Effect.logWarning(`The new build cannot take up the press, so it starts over: ${reason}`),
        Effect.sync(() => import.meta.hot?.invalidate(reason)),
      ),
    ),
    Effect.provide(BrowserWorkerRunner.layer),
    Effect.scoped,
  ),
);

import.meta.hot?.accept();
