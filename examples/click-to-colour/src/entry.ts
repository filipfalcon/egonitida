import { BrowserWorker } from '@effect/platform-browser';
import { Clicking, Drawing, View, Viewport } from '@lightocean/client';
import { Client, WorkerTransport } from '@lightocean/core';
import { Effect, Option } from 'effect';
import * as Three from 'three/webgpu';
import * as Colour from '#src/colour.ts';
import * as ColourView from '#src/colour.view.ts';

// The page: joins the local server in a worker, draws the cubes through their view at every frame the display shows, and sends every click on a cube as the game's Clicked.
const main = Effect.gen(function* () {
  const canvas = document.querySelector('canvas');
  if (!(canvas instanceof HTMLCanvasElement)) {
    return yield* Effect.die('The page has no canvas.');
  }
  const connection = yield* WorkerTransport.connect;
  const client = yield* Client.connect(connection, { game: Colour.game });
  const drawing = yield* Drawing.make(client, { keepSeconds: 1 });
  const viewport = yield* Viewport.make(canvas);
  const views = yield* View.make(ColourView.views);

  viewport.scene.add(views.root, new Three.AmbientLight(0xffffff, 0.5));
  const sun = new Three.DirectionalLight(0xffffff, 2);
  sun.position.set(3, 5, 4);
  viewport.scene.add(sun);
  viewport.camera.position.set(0, 2.5, 6);
  viewport.camera.lookAt(0, 0, 0);

  yield* Clicking.serve({ clicks: viewport.clicks, camera: viewport.camera, views, client });
  yield* viewport.loop((seconds) =>
    Option.match(drawing.frame(seconds), { onNone: () => Effect.void, onSome: views.frame }),
  );
  return yield* Effect.never;
}).pipe(
  Effect.provide(
    BrowserWorker.layer(
      () => new Worker(new URL('./simulation.worker.ts', import.meta.url), { type: 'module' }),
    ),
  ),
  Effect.scoped,
);

Effect.runFork(main);
