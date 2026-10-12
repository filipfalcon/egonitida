import { BrowserWorkerRunner } from '@effect/platform-browser';
import { Host, WorkerTransport } from '@lightocean/core';
import { Beside } from '@lightocean/devtools';
import { Effect } from 'effect';
import * as Beginning from '#src/beginning.ts';
import * as Glance from '#src/glance.ts';
import * as Stepping from '#src/stepping.ts';

// The local server of the game that tells how a state begins, stepped off the main thread; the page may stop its time, and step it while it is stopped. The telling starts anew every time the page is opened, so nothing of it is kept: in development the devtools run beside it, by the id the page named this worker with, but it goes on from no state but its first.
const options = { ...Glance.setup, state: Glance.state, mayHold: true };

/** Serves `host` to the page, which may stop its time and step it while stopped; and begins its state anew at the point the telling comes to. */
const serving = (host: Host.Host) =>
  Effect.all([Stepping.carryOut(host), Beginning.serve(host)]).pipe(
    Effect.andThen(WorkerTransport.serveHost(host)),
  );

Effect.runFork(
  Effect.gen(function* () {
    const host = yield* Host.make(options);
    if (import.meta.env.DEV) {
      yield* Beside.serve(host, options, { name: 'glance', id: self.name });
    }
    yield* serving(host);
  }).pipe(Effect.provide(BrowserWorkerRunner.layer), Effect.scoped),
);
