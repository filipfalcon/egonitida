import { BrowserWorker } from '@effect/platform-browser';
import { Drawing, View, Viewport } from '@lightocean/client';
import { Client, WorkerTransport } from '@lightocean/core';
import { Effect, Option } from 'effect';
import * as Three from 'three/webgpu';
import * as Cube from '#src/cube.ts';
import * as CubeView from '#src/cube.view.ts';

// The page: joins the local server in a worker, and draws its world through the cube's views at every frame the display shows.
const main = Effect.gen(function* () {
  const canvas = document.querySelector('canvas');
  if (!(canvas instanceof HTMLCanvasElement)) {
    return yield* Effect.die('The page has no canvas.');
  }
  const connection = yield* WorkerTransport.connect;
  const client = yield* Client.connect(connection, { game: Cube.game });
  const drawing = yield* Drawing.make(client, { keepSeconds: 1 });
  const viewport = yield* Viewport.make(canvas);
  const views = yield* View.make(CubeView.views);

  viewport.scene.add(views.root);
  viewport.scene.add(new Three.AmbientLight(0xffffff, 0.4));
  const sun = new Three.DirectionalLight(0xffffff, 2);
  sun.position.set(3, 5, 4);
  viewport.scene.add(sun);
  viewport.camera.position.set(0, 1.5, 3);
  viewport.camera.lookAt(0, 0, 0);

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
