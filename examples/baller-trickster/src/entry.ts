import { BrowserWorker } from '@effect/platform-browser';
import { Controls, Drawing, Hearing, View, Viewport } from '@lightocean/client';
import { Client, WorkerTransport } from '@lightocean/core';
import { Effect, Option } from 'effect';
import * as Three from 'three/webgpu';
import * as Baller from '#src/baller.ts';
import * as BallerView from '#src/baller.view.ts';
import * as Camera from '#src/camera.ts';
import * as BallerControls from '#src/controls.ts';
import * as Model from '#src/model.ts';

// The page: joins the local server in a worker as a baller, sends where the sticks place her feet every frame, puts the ball back at a press, and draws her and the ball at every frame the display shows, from where the player turns the camera about her.
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
  // Where the player looks at her from, played on from the sticks every frame.
  const played = {
    controls: Controls.start(BallerControls.bindings),
    feet: Baller.idle,
    orbit: Camera.start,
  };
  const views = yield* View.make(
    BallerView.make(model).views,
    Option.some({ camera: viewport.camera, player: client.entity }),
    () => played.orbit,
  );
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
  hud.textContent = [
    'left stick or WASD: left foot',
    'right stick or IJKL: right foot',
    'triggers or Q and U: lift them',
    'L3 or R3 held, or Shift: the stick turns the camera',
    'Triangle or R: the ball back',
  ].join('\n');

  yield* viewport.loop((seconds) =>
    Option.match(drawing.frame(seconds), {
      onNone: () => Effect.void,
      onSome: (frame) =>
        Effect.gen(function* () {
          played.controls = Controls.read(BallerControls.bindings, hearing.read(), played.controls);
          played.feet = BallerControls.feetOf(played.controls, played.feet);
          played.orbit = Camera.orbit(played.controls, played.orbit, seconds);
          yield* client.send([Baller.Feet.of(played.feet)]);
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
