import { BrowserWorkerRunner } from '@effect/platform-browser';
import { Host, WorkerTransport, State } from '@lightocean/core';
import { Beside, Debugger } from '@lightocean/devtools';
import { Effect, Option } from 'effect';
import * as Playing from '#src/playing.ts';

// The document playing: a local server of its own, started from the document as the editor had it when Play was pressed, which the page opens this worker with. Whoever joins is a player, whose clicks make the objects react. Stopping ends the worker, and everything that happened while playing with it. The debugger is always beside it, for the editor's page to ask; in development the rest of the devtools are too, by the id the page named this worker with.

/** The host of the document the page opened this worker with. */
const hostOf = (opening: string) =>
  Option.match(Playing.fromOpening(opening), {
    onNone: () => Effect.die('The page opened the worker with no document to play.'),
    onSome: (state) =>
      Effect.gen(function* () {
        const options = {
          game: Playing.game,
          state,
          join: (joining: State.State) => State.spawn(joining, []),
          leave: State.despawn,
          mayHold: true,
        };
        const host = yield* Host.make(options);
        yield* import.meta.env.DEV
          ? Beside.serve(host, options, { name: 'playing', id: self.name })
          : Effect.asVoid(Debugger.serve(host, options));
        return host;
      }),
  });

Effect.runFork(
  WorkerTransport.serveOpened(hostOf).pipe(
    Effect.provide(BrowserWorkerRunner.layer),
    Effect.scoped,
  ),
);
