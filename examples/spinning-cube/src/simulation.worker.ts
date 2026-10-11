import { BrowserWorkerRunner } from '@effect/platform-browser';
import { WorkerTransport, World } from '@lightocean/core';
import { Effect } from 'effect';
import * as Cube from '#src/cube.ts';

// The local server: the cube's world, stepped off the main thread. A page that joins controls nothing; it only watches.
Effect.runFork(
  WorkerTransport.serve({
    game: Cube.game,
    world: Cube.world,
    join: (world) => World.spawn(world, []),
    leave: World.despawn,
    mayHold: true,
  }).pipe(Effect.provide(BrowserWorkerRunner.layer), Effect.scoped),
);
