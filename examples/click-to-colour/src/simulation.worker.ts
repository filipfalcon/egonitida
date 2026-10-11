import { BrowserWorkerRunner } from '@effect/platform-browser';
import { Host, WorkerTransport, World } from '@lightocean/core';
import { Beside } from '@lightocean/devtools';
import { Effect } from 'effect';
import * as Colour from '#src/colour.ts';

// The local server: the cubes' world, stepped off the main thread. A page that joins is whoever clicks: an entity that holds nothing, whom its clicks are from. In development the devtools run beside it, by the id the page named this worker with.
const setup = {
  game: Colour.game,
  join: (world: World.World) => World.spawn(world, []),
  leave: World.despawn,
};

Effect.runFork(
  Effect.gen(function* () {
    const host = yield* Host.make({ ...setup, world: Colour.world, mayHold: true });
    if (import.meta.env.DEV) {
      yield* Beside.serve(host, setup, {
        name: 'cubes',
        id: self.name === '' ? undefined : self.name,
      });
    }
    yield* WorkerTransport.serveHost(host);
  }).pipe(Effect.provide(BrowserWorkerRunner.layer), Effect.scoped),
);
