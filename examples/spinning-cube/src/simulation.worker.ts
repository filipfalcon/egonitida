import { BrowserWorkerRunner } from '@effect/platform-browser';
import { WorkerTransport, State } from '@egonitida/core';
import { Effect } from 'effect';
import * as Cube from '#src/cube.ts';

// The local server: the cube's game, stepped off the main thread. A page that joins controls nothing; it only watches.
Effect.runFork(
  WorkerTransport.serve({
    game: Cube.game,
    state: Cube.state,
    join: (state) => State.spawn(state, []),
    leave: State.despawn,
    maySuspend: true,
  }).pipe(Effect.provide(BrowserWorkerRunner.layer), Effect.scoped),
);
