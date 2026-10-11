import { BrowserWorkerRunner } from '@effect/platform-browser';
import { Host, WorkerTransport, World } from '@lightocean/core';
import { Beside } from '@lightocean/devtools';
import { Effect } from 'effect';
import * as Colour from '#src/colour.ts';

// The local server: the cubes' world, stepped off the main thread. A page that joins is whoever clicks: an entity that holds nothing, whom its clicks are from. In development it goes on from the world kept for the tab whatever code changed, as the horde's does, with the devtools beside it, by the id the page named this worker with.
const options = {
  game: Colour.game,
  join: (world: World.World) => World.spawn(world, []),
  leave: World.despawn,
  world: Colour.world,
  mayHold: true,
};

Effect.runFork(
  (import.meta.env.DEV
    ? Beside.host(
        options,
        { name: 'cubes', id: self.name, kept: import.meta.hot?.data },
        WorkerTransport.serveHost,
      )
    : Effect.flatMap(Host.make(options), WorkerTransport.serveHost)
  ).pipe(
    Effect.catchTag('Unreadable', ({ reason }) =>
      Effect.andThen(
        Effect.logWarning(
          `The new build cannot take up the cubes' world, so it starts over: ${reason}`,
        ),
        Effect.sync(() => import.meta.hot?.invalidate(reason)),
      ),
    ),
    Effect.provide(BrowserWorkerRunner.layer),
    Effect.scoped,
  ),
);

import.meta.hot?.accept();
