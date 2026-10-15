import { BrowserWorker } from '@effect/platform-browser';
import { Drawing, Hearing, View, Viewport } from '@egonitida/client';
import { Client, WorkerTransport } from '@egonitida/core';
import { Effect, Option } from 'effect';
import * as Three from 'three/webgpu';
import * as FigureControls from '#src/controls.ts';
import * as Figure from '#src/figure.ts';
import * as FigureView from '#src/figure.view.ts';

// The page: joins the local server in a worker as a figure, sends every turn of her dials the player gives with the arrow keys or a pad, and draws her, shaped as the state holds her, at every frame the display shows; the dials and their values stand beside her.
const main = Effect.gen(function* () {
  const canvas = document.querySelector('canvas');
  const hud = document.querySelector('#hud');
  if (!(canvas instanceof HTMLCanvasElement) || !(hud instanceof HTMLElement)) {
    return yield* Effect.die('The page has no canvas or no HUD.');
  }
  const connection = yield* WorkerTransport.connect;
  const client = yield* Client.connect(connection, { game: Figure.game });
  const drawing = yield* Drawing.make(client, { keepSeconds: 1 });
  const viewport = yield* Viewport.make(canvas, Viewport.sharp);
  const views = yield* View.make(FigureView.views);
  const hearing = yield* Hearing.make(window, {});

  viewport.scene.add(views.root, new Three.HemisphereLight(0xdde6f0, 0x2b2f33, 2));
  const sun = new Three.DirectionalLight(0xffffff, 1.5);
  sun.position.set(2, 4, 3);
  viewport.scene.add(sun);
  viewport.camera.position.set(1.4, 1.3, 2.8);
  viewport.camera.lookAt(0, 0.95, 0);

  const played = { last: FigureControls.start };
  yield* viewport.loop((seconds) =>
    Option.match(drawing.frame(seconds), {
      onNone: () => Effect.void,
      onSome: (frame) =>
        Effect.gen(function* () {
          played.last = FigureControls.play(hearing.read(), played.last);
          yield* Option.match(played.last.turned, {
            onNone: () => Effect.void,
            onSome: (turn) => client.act(Figure.TurnedDial, turn),
          });
          yield* views.frame(frame);
          hud.textContent = Option.match(frame.get(client.entity, Figure.Shape), {
            onNone: () => '',
            onSome: (shape) =>
              [
                ...Figure.DIALS.map(
                  (dial) =>
                    `${dial === played.last.chosen ? '>' : ' '} ${dial.padEnd(5)} ${shape[dial].toFixed(2)}`,
                ),
                '',
                'up and down choose a dial, left and right turn it',
              ].join('\n'),
          });
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
