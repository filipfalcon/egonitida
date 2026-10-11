import { BrowserWorker } from '@effect/platform-browser';
import { Clicking, Drawing, Mirror, Tab, View, Viewport } from '@lightocean/client';
import { Client, WorkerTransport } from '@lightocean/core';
import { Bridge, Page } from '@lightocean/devtools';
import { Effect, Option } from 'effect';
import * as Three from 'three/webgpu';
import * as Colour from '#src/colour.ts';
import * as ColourView from '#src/colour.view.ts';

// The page: joins the local server in a worker, draws the cubes through their view at every frame the display shows, and sends every click on a cube as the game's Clicked; the cubes are mirrored as buttons for the keyboard and a screen reader. In development, it shows an agent what it draws.
/** The id the devtools know this page's host by, kept by the tab across reloads, and given to its worker as its name: so the page can say which host it draws, and the worker finds the world kept for the tab. */
const host = Tab.id('cubes');

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
  // The cubes stand in a list read out by their labels too, so they can be reached and clicked from the keyboard.
  const mirror = yield* Mirror.make({
    container: document.body,
    views,
    scene: viewport.scene,
    client,
  });
  // In development, an agent asking through the development server can see what this page draws.
  if (import.meta.env.DEV) {
    yield* Option.match(Bridge.vite, {
      onNone: () => Effect.void,
      onSome: (channel) =>
        Page.serve(channel, {
          host,
          capture: (width) => viewport.capture(width).pipe(Effect.mapError(({ reason }) => reason)),
        }),
    });
  }
  yield* viewport.loop((seconds) =>
    Option.match(drawing.frame(seconds), {
      onNone: () => Effect.void,
      onSome: (frame) => Effect.andThen(views.frame(frame), mirror.frame(frame)),
    }),
  );
  return yield* Effect.never;
}).pipe(
  Effect.provide(
    BrowserWorker.layer(
      () =>
        new Worker(new URL('./simulation.worker.ts', import.meta.url), {
          type: 'module',
          name: host,
        }),
    ),
  ),
  Effect.scoped,
);

Effect.runFork(main);
