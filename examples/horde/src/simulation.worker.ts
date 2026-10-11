import { BrowserWorkerRunner } from '@effect/platform-browser';
import { Host, WorkerTransport, World } from '@lightocean/core';
import { Beside } from '@lightocean/devtools';
import { Effect } from 'effect';
import * as Game from '#src/game.ts';
import * as Survivor from '#src/survivor.ts';

// The local server: the arena stepped off the main thread, with a survivor for every page that joins. In development it goes on from the world kept for the tab, whatever code changed: a change to the game hands the host the new build, which plays on from the world it was at, and any other change reloads the page, which comes back to the world kept a moment before; a build that cannot take that world up starts afresh, saying why. The devtools run beside it, by the id the page named this worker with.
const options = {
  game: Game.game,
  join: Survivor.join,
  leave: World.despawn,
  world: Game.world,
  mayHold: true,
};

Effect.runFork(
  (import.meta.env.DEV
    ? Beside.host(
        options,
        { name: 'horde', id: self.name, kept: import.meta.hot?.data },
        WorkerTransport.serveHost,
      )
    : Effect.flatMap(Host.make(options), WorkerTransport.serveHost)
  ).pipe(
    Effect.catchTag('Unreadable', ({ reason }) =>
      Effect.andThen(
        Effect.logWarning(
          `The new build cannot take up the horde's world, so it starts over: ${reason}`,
        ),
        Effect.sync(() => import.meta.hot?.invalidate(reason)),
      ),
    ),
    Effect.provide(BrowserWorkerRunner.layer),
    Effect.scoped,
  ),
);

import.meta.hot?.accept();
