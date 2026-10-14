import { BrowserWorkerRunner } from '@effect/platform-browser';
import { WorkerTransport, State } from '@lightocean/core';
import { Effect } from 'effect';
import * as Figure from '#src/figure.ts';

// The local server: the figure's game, stepped off the main thread, with a figure for every page that joins.
Effect.runFork(
  WorkerTransport.serve({
    game: Figure.game,
    state: Figure.state,
    join: Figure.join,
    leave: State.despawn,
    maySuspend: true,
  }).pipe(Effect.provide(BrowserWorkerRunner.layer), Effect.scoped),
);
