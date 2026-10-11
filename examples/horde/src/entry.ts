import { BrowserWorker } from '@effect/platform-browser';
import { Drawing, View, Viewport } from '@lightocean/client';
import { Client, WorkerTransport } from '@lightocean/core';
import { Effect, Option } from 'effect';
import * as Three from 'three/webgpu';
import * as Body from '#src/body.ts';
import * as Game from '#src/game.ts';
import * as HordeView from '#src/horde.view.ts';
import * as Survivor from '#src/survivor.ts';
import * as SurvivorView from '#src/survivor.view.ts';

// The page: joins the local server in a worker as a survivor, sends what the keyboard and the mouse hold and do, and draws the arena through the game's views at every frame the display shows.

/** Which way each key walks, on the floor as the camera looks at it. */
const WALKS: Readonly<Record<string, readonly [number, number]>> = {
  KeyW: [0, -1],
  KeyS: [0, 1],
  KeyA: [-1, 0],
  KeyD: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
};

/** Listens to `type` on the window until the scope closes. */
const listen = <K extends keyof WindowEventMap>(
  type: K,
  handler: (event: WindowEventMap[K]) => void,
) =>
  Effect.acquireRelease(
    Effect.sync(() => window.addEventListener(type, handler)),
    () => Effect.sync(() => window.removeEventListener(type, handler)),
  );

const main = Effect.gen(function* () {
  const canvas = document.querySelector('canvas');
  const hud = document.querySelector('#hud');
  if (!(canvas instanceof HTMLCanvasElement) || !(hud instanceof HTMLElement)) {
    return yield* Effect.die('The page has no canvas or no HUD.');
  }
  const connection = yield* WorkerTransport.connect;
  const client = yield* Client.connect(connection, { game: Game.game });
  const drawing = yield* Drawing.make(client, { keepSeconds: 1 });
  const viewport = yield* Viewport.make(canvas);
  const views = yield* View.make([...SurvivorView.views, ...HordeView.views]);

  const floor = new Three.Mesh(
    new Three.CircleGeometry(Body.ARENA_RADIUS, 64),
    new Three.MeshStandardNodeMaterial({ color: 0x2b2f33 }),
  );
  floor.rotation.x = -Math.PI / 2;
  viewport.scene.add(views.root, floor, new Three.AmbientLight(0xffffff, 0.5));
  const sun = new Three.DirectionalLight(0xffffff, 2);
  sun.position.set(4, 10, 6);
  viewport.scene.add(sun);
  viewport.camera.position.set(0, 18, 13);
  viewport.camera.lookAt(0, 0, 0);

  // What the player holds and has done since the last frame.
  const held = new Set<string>();
  const pointer = new Three.Vector2();
  const done = { fired: false, restarted: false };
  yield* listen('keydown', (event) => {
    held.add(event.code);
    done.restarted ||= event.code === 'KeyR';
  });
  yield* listen('keyup', (event) => held.delete(event.code));
  yield* listen('pointermove', (event) => {
    pointer.set((event.clientX / innerWidth) * 2 - 1, -(event.clientY / innerHeight) * 2 + 1);
  });
  yield* listen('pointerdown', () => {
    done.fired = true;
  });

  const ground = new Three.Plane(new Three.Vector3(0, 1, 0), 0);
  const ray = new Three.Raycaster();
  const aimed = new Three.Vector3();

  yield* viewport.loop((seconds) =>
    Option.match(drawing.frame(seconds), {
      onNone: () => Effect.void,
      onSome: (frame) =>
        Effect.gen(function* () {
          const walk = [...held].reduce(
            (sum, code) => {
              const [x, z] = WALKS[code] ?? [0, 0];
              return { x: sum.x + x, z: sum.z + z };
            },
            { x: 0, z: 0 },
          );
          ray.setFromCamera(pointer, viewport.camera);
          const at = Option.getOrElse(frame.get(client.entity, Body.Position), () => ({
            x: 0,
            z: 0,
          }));
          const aim =
            ray.ray.intersectPlane(ground, aimed) === null
              ? 0
              : Math.atan2(aimed.z - at.z, aimed.x - at.x);
          yield* client.send([Survivor.Stick.of({ ...walk, aim })]);
          if (done.fired) {
            done.fired = false;
            yield* client.act(Survivor.PulledTrigger, {});
          }
          if (done.restarted) {
            done.restarted = false;
            yield* client.act(Survivor.ChoseRestart, {});
          }
          yield* views.frame(frame);
          hud.textContent = Option.match(
            Option.all({
              life: frame.get(client.entity, Survivor.Life),
              tally: frame.get(client.entity, Survivor.Tally),
            }),
            {
              onNone: () => '',
              onSome: ({ life, tally }) =>
                [
                  life._tag === 'Alive' ? `health ${life.health}` : 'dead: R to rise again',
                  `kills ${tally.kills}`,
                ].join('\n'),
            },
          );
        }),
    }),
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
