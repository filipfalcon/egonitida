import { BrowserWorker } from '@effect/platform-browser';
import {
  Chroma,
  type Devices,
  Drawing,
  DualSense,
  Gamepads,
  Haptics,
  Hid,
  KeyboardAndMouse,
  Lighting,
  Tab,
  View,
  Viewport,
} from '@lightocean/client';
import { Client, WorkerTransport } from '@lightocean/core';
import { Bridge, Page, Rewind } from '@lightocean/devtools';
import { Effect, Option, type Scope } from 'effect';
import { FetchHttpClient } from 'effect/http';
import * as Three from 'three/webgpu';
import * as Body from '#src/body.ts';
import * as HordeControls from '#src/controls.ts';
import * as Game from '#src/game.ts';
import * as HordeView from '#src/horde.view.ts';
import * as Survivor from '#src/survivor.ts';
import * as SurvivorView from '#src/survivor.view.ts';

// The page: joins the local server in a worker as a survivor, sends what the player does with a pad, or the keyboard and the mouse, draws the arena through the game's views at every frame the display shows, makes the player feel what happens to their survivor through their pads, and lights their pads and their Razer devices from it. In development, keys drive the rewind beside the host.

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

/** The id the devtools know this page's host by, kept by the tab across reloads, and given to its worker as its name: so the page can say which host it draws, and the worker finds the world kept for the tab. */
const host = Tab.id('horde');

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

  const floor = new Three.Mesh(
    new Three.CircleGeometry(Body.ARENA_RADIUS, 64),
    new Three.MeshStandardNodeMaterial({ color: 0x2b2f33 }),
  );
  floor.rotation.x = -Math.PI / 2;
  viewport.scene.add(floor, new Three.AmbientLight(0xffffff, 0.5));
  const sun = new Three.DirectionalLight(0xffffff, 2);
  sun.position.set(4, 10, 6);
  viewport.scene.add(sun);
  viewport.camera.position.set(0, 18, 13);
  viewport.camera.lookAt(0, 0, 0);

  const keyboardAndMouse = yield* KeyboardAndMouse.make(window);
  // Pads through WebHID: those the player gave leave for before, and more at H, a key being the gesture a browser asks for.
  const drivers = [DualSense.driver];
  const hid = { connections: [...(yield* Hid.granted(drivers))] };
  // The survivor's player feels it on every pad that can be felt: through WebHID where it is read through it, else through the Gamepad API.
  const haptics = Haptics.make({
    player: client.entity,
    felt: () => [
      ...hid.connections.map(({ felt }) => felt),
      ...Gamepads.feltNow(hid.connections.map(({ model }) => model)),
    ],
  });
  // Their lights too: a pad's through WebHID, and Razer's devices through Chroma once the player asks for it at C, as asking a machine with no Razer software for it fails aloud.
  const chroma = { lit: new Array<Lighting.Lit>() };
  const lighting = Lighting.make({
    player: client.entity,
    lit: () => [...hid.connections.map(({ lit }) => lit), ...chroma.lit],
  });
  const felt = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provideService(Haptics.Haptics, haptics),
      Effect.provideService(Lighting.Lighting, lighting),
    );
  const views = yield* felt(View.make([...SurvivorView.views, ...HordeView.views]));
  viewport.scene.add(views.root);
  // What a key starts runs within the page's scope, so a device connected at it stays connected while the page is open.
  const run = Effect.runForkWith(yield* Effect.context<Scope.Scope>());
  yield* listen('keydown', (event) => {
    if (event.code === 'KeyH' && Hid.available()) {
      run(
        Hid.request(drivers).pipe(
          Effect.tap((connected) =>
            Effect.sync(() => {
              hid.connections.push(...connected);
            }),
          ),
          Effect.andThen(lighting.again),
          Effect.catch(({ reason }) => Effect.logWarning(reason)),
        ),
      );
    }
  });
  const app: Chroma.App = {
    title: 'Horde',
    description: 'Survive the horde, lit by how much health is left.',
    author: { name: 'LightOcean', contact: 'https://github.com/filipfalcon/lightocean' },
    category: 'game',
  };
  yield* listen('keydown', (event) => {
    if (event.code === 'KeyC' && chroma.lit.length === 0) {
      run(
        Chroma.connect(app).pipe(
          Effect.tap((lit) =>
            Effect.sync(() => {
              chroma.lit.push(lit);
            }),
          ),
          Effect.andThen(lighting.again),
          Effect.catch(({ reason }) => Effect.logWarning(reason)),
          Effect.provide(FetchHttpClient.layer),
        ),
      );
    }
  });
  const done = { asked: new Array<Asked>() };
  if (import.meta.env.DEV) {
    yield* listen('keydown', (event) => {
      done.asked.push(...Option.toArray(asked(event)));
    });
  }
  const played = { last: HordeControls.start };

  const ground = new Three.Plane(new Three.Vector3(0, 1, 0), 0);
  const ray = new Three.Raycaster();
  const aimed = new Three.Vector3();
  const rewind = Rewind.controls(client);
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
          // A pad read through WebHID is left out of the Gamepad API's, so it does not count twice.
          const devices: Devices.State = {
            pads: [
              ...hid.connections.flatMap((connection) => Option.toArray(connection.pad())),
              ...Gamepads.poll(
                [],
                hid.connections.map(({ model }) => model),
              ),
            ],
            ...keyboardAndMouse.read(),
          };
          const at = Option.getOrElse(frame.get(client.entity, Body.Position), () => ({
            x: 0,
            z: 0,
          }));
          // Where the mouse points on the floor, as an angle from the survivor.
          const mouseAim = Option.flatMap(devices.mouse.at, (point) => {
            const { x, y } = Viewport.pointOf(
              { clientX: point.x, clientY: point.y },
              canvas.getBoundingClientRect(),
            );
            ray.setFromCamera(new Three.Vector2(x, y), viewport.camera);
            return ray.ray.intersectPlane(ground, aimed) === null
              ? Option.none()
              : Option.some(Math.atan2(aimed.z - at.z, aimed.x - at.x));
          });
          const now = HordeControls.play(devices, played.last, mouseAim);
          played.last = now;
          yield* Effect.forEach(done.asked.splice(0), answer, { discard: true });
          if (!time.paused) {
            yield* client.send([Survivor.Stick.of(now.stick)]);
          }
          if (now.fired && !time.paused) {
            yield* client.act(Survivor.PulledTrigger, {});
          }
          if (now.restarted && !time.paused) {
            yield* client.act(Survivor.ChoseRestart, {});
          }
          yield* felt(views.frame(frame));
          hud.textContent = Option.match(
            Option.all({
              life: frame.get(client.entity, Survivor.Life),
              tally: frame.get(client.entity, Survivor.Tally),
            }),
            {
              onNone: () => '',
              onSome: ({ life, tally }) =>
                [
                  life._tag === 'Alive'
                    ? `health ${life.health}`
                    : `dead: ${Option.contains(played.last.controls.active, 'Pad') ? 'Start' : 'R'} to rise again`,
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
                  ...(Hid.available() && hid.connections.length === 0
                    ? ['H connects a DualSense through WebHID']
                    : []),
                  ...(chroma.lit.length === 0 ? ['C lights Razer devices through Chroma'] : []),
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
