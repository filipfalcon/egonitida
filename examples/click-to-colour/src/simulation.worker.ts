import { BrowserWorkerRunner } from '@effect/platform-browser';
import { WorkerTransport, World } from '@lightocean/core';
import { Effect } from 'effect';
import * as Colour from '#src/colour.ts';

// The local server: the cubes' world, stepped off the main thread. A page that joins is whoever clicks: an entity that holds nothing, whom its clicks are from.
Effect.runFork(
  WorkerTransport.serve({
    game: Colour.game,
    world: Colour.world,
    join: (world) => World.spawn(world, []),
    leave: World.despawn,
    mayHold: true,
  }).pipe(Effect.provide(BrowserWorkerRunner.layer), Effect.scoped),
);
