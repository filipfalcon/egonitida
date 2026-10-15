import { BrowserWorkerRunner } from '@effect/platform-browser';
import { State, WorkerTransport } from '@lightocean/core';
import { Effect } from 'effect';
import * as Baller from '#src/baller.ts';

// The local server: the baller's game, stepped off the main thread, with a baller for every page that joins.
Effect.runFork(
  WorkerTransport.serve({
    game: Baller.game,
    state: Baller.state,
    join: Baller.join,
    leave: State.despawn,
    maySuspend: true,
  }).pipe(Effect.provide(BrowserWorkerRunner.layer), Effect.scoped),
);
