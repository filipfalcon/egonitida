import { BrowserWorker } from '@effect/platform-browser';
import { Drawing, View, Viewport } from '@lightocean/client';
import { Client, WorkerTransport } from '@lightocean/core';
import { Rewind } from '@lightocean/devtools';
import { Effect, Option } from 'effect';
import * as Three from 'three/webgpu';
import * as Body from '#src/body.ts';
import * as Game from '#src/game.ts';
import * as HordeView from '#src/horde.view.ts';
import * as Survivor from '#src/survivor.ts';
import * as SurvivorView from '#src/survivor.view.ts';

// The page: joins the local server in a worker as a survivor, sends what the keyboard and the mouse hold and do, and draws the arena through the game's views at every frame the display shows. In development, keys drive the rewind beside the host.

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

/** What each key asks of the rewind beside the host, in development: to hold time, to step back or forth, to play on from the tick shown, or to go live. */
type Asked =
  | { readonly _tag: 'Pause' }
  | { readonly _tag: 'Step'; readonly steps: number }
  | { readonly _tag: 'PlayFromHere' }
  | { readonly _tag: 'Live' };

const asked = (event: KeyboardEvent): Option.Option<Asked> => {
  const by = event.shiftKey ? 10 : 1;
  switch (event.code) {
    case 'KeyP':
      return Option.some({ _tag: 'Pause' });
    case 'Comma':
      return Option.some({ _tag: 'Step', steps: -by });
    case 'Period':
      return Option.some({ _tag: 'Step', steps: by });
    case 'Enter':
      return Option.some({ _tag: 'PlayFromHere' });
    case 'KeyL':
      return Option.some({ _tag: 'Live' });
    default:
      return Option.none();
  }
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
  const done = { fired: false, restarted: false, asked: new Array<Asked>() };
  yield* listen('keydown', (event) => {
    held.add(event.code);
    done.restarted ||= event.code === 'KeyR';
    if (import.meta.env.DEV) {
      done.asked.push(...Option.toArray(asked(event)));
    }
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
  const rewind = Rewind.controls(client);
  const time = { paused: false };
  /** Does what a key asked of the rewind; while time is held, the player does nothing else. */
  const answer = (asking: Asked) => {
    switch (asking._tag) {
      case 'Pause':
        if (time.paused) {
          return Effect.void;
        }
        time.paused = true;
        return rewind.pause;
      case 'Step':
        return time.paused ? rewind.step(asking.steps) : Effect.void;
      case 'PlayFromHere':
        time.paused = false;
        return rewind.playFromHere;
      case 'Live':
        time.paused = false;
        return rewind.live;
    }
  };

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
          yield* Effect.forEach(done.asked.splice(0), answer, { discard: true });
          if (!time.paused) {
            yield* client.send([Survivor.Stick.of({ ...walk, aim })]);
          }
          if (done.fired && !time.paused) {
            yield* client.act(Survivor.PulledTrigger, {});
          }
          if (done.restarted && !time.paused) {
            yield* client.act(Survivor.ChoseRestart, {});
          }
          done.fired = false;
          done.restarted = false;
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
                  ...(time.paused
                    ? [
                        '',
                        `paused at tick ${Math.round(frame.tick)}`,
                        ', . step back and forth (shift: by ten)',
                        'enter plays on from here, L goes live',
                      ]
                    : import.meta.env.DEV
                      ? ['', 'P pauses']
                      : []),
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

// In development, a change to the game reaches the worker, which takes it up and plays on; the page goes on drawing with the views it has, until it is reloaded.
import.meta.hot?.accept(
  [
    '#src/body.ts',
    '#src/game.ts',
    '#src/horde.view.ts',
    '#src/survivor.ts',
    '#src/survivor.view.ts',
  ],
  () => {},
);
