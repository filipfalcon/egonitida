import { BrowserWorkerRunner } from '@effect/platform-browser';
import { WorkerTransport, World } from '@lightocean/core';
import { Effect } from 'effect';
import * as Game from '#src/game.ts';
import * as Survivor from '#src/survivor.ts';

// The local server: the arena stepped off the main thread, with a survivor for every page that joins.
Effect.runFork(
  WorkerTransport.serve({
    game: Game.game,
    world: Game.world,
    join: Survivor.join,
    leave: World.despawn,
    mayHold: true,
  }).pipe(Effect.provide(BrowserWorkerRunner.layer), Effect.scoped),
);
