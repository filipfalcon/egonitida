import { BrowserWorker } from '@effect/platform-browser';
import { Controls, Drawing, Hearing, View, Viewport } from '@lightocean/client';
import { Client, WorkerTransport } from '@lightocean/core';
import { Effect, Option } from 'effect';
import * as Three from 'three/webgpu';
import * as Baller from '#src/baller.ts';
import * as BallerView from '#src/baller.view.ts';
import * as BallerControls from '#src/controls.ts';
import * as Model from '#src/model.ts';

// The page: joins the local server in a worker as a baller, sends where the sticks place her feet every frame, puts the ball back at a press, and draws her and the ball at every frame the display shows, from behind her.
const main = Effect.gen(function* () {
  const canvas = document.querySelector('canvas');
  const hud = document.querySelector('#hud');
  if (!(canvas instanceof HTMLCanvasElement) || !(hud instanceof HTMLElement)) {
    return yield* Effect.die('The page has no canvas or no HUD.');
  }
  const connection = yield* WorkerTransport.connect;
  const client = yield* Client.connect(connection, { game: Baller.game });
  const drawing = yield* Drawing.make(client, { keepSeconds: 1 });
  const viewport = yield* Viewport.make(canvas, Viewport.sharp);
  const model = yield* Effect.cached(Model.load);
  const views = yield* View.make(BallerView.make(model).views);
  const hearing = yield* Hearing.make(window, {});

  const ground = new Three.Mesh(
    new Three.PlaneGeometry(20, 20),
    new Three.MeshStandardNodeMaterial({ color: 0x2f6b34, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  viewport.scene.add(views.root, ground, new Three.HemisphereLight(0xdde6f0, 0x2b2f33, 2));
  const sun = new Three.DirectionalLight(0xffffff, 1.5);
  sun.position.set(2, 4, -3);
  viewport.scene.add(sun);
  // From behind her, so a stick pushed right sends her foot right.
  viewport.camera.position.set(0, 1.5, -2.2);
  viewport.camera.lookAt(0, 0.6, 0.6);
  hud.textContent = [
    'left stick or WASD: left foot',
    'right stick or IJKL: right foot',
    'triggers or Q and U: lift them',
    'Triangle or R: the ball back',
  ].join('\n');

  const played = { controls: Controls.start(BallerControls.bindings) };
  yield* viewport.loop((seconds) =>
    Option.match(drawing.frame(seconds), {
      onNone: () => Effect.void,
      onSome: (frame) =>
        Effect.gen(function* () {
          played.controls = Controls.read(BallerControls.bindings, hearing.read(), played.controls);
          yield* client.send([Baller.Feet.of(BallerControls.feetOf(played.controls))]);
          if (BallerControls.replaced(played.controls)) {
            yield* client.act(Baller.ReplacedBall, {});
          }
          yield* views.frame(frame);
        }),
    }).pipe(Effect.andThen(viewport.render)),
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
