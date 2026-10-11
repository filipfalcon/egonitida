import { BrowserWorkerRunner } from '@effect/platform-browser';
import { Host, WorkerTransport, World } from '@lightocean/core';
import { Beside } from '@lightocean/devtools';
import { Effect, Option } from 'effect';
import * as Playing from '#src/playing.ts';

// The document playing: a local server of its own, started from the document as the editor had it when Play was pressed, which the page opens this worker with. Whoever joins is a player, whose clicks make the objects react. Stopping ends the worker, and everything that happened while playing with it. In development the devtools are beside it, by the id the page named this worker with.

/** The host of the document the page opened this worker with. */
const hostOf = (opening: string) =>
  Option.match(Playing.fromOpening(opening), {
    onNone: () => Effect.die('The page opened the worker with no document to play.'),
    onSome: (world) =>
      Effect.gen(function* () {
        const options = {
          game: Playing.game,
          world,
          join: (joining: World.World) => World.spawn(joining, []),
          leave: World.despawn,
          mayHold: true,
        };
        const host = yield* Host.make(options);
        if (import.meta.env.DEV) {
          yield* Beside.serve(host, options, { name: 'playing', id: self.name });
        }
        return host;
      }),
  });

Effect.runFork(
  WorkerTransport.serveOpened(hostOf).pipe(
    Effect.provide(BrowserWorkerRunner.layer),
    Effect.scoped,
  ),
);
