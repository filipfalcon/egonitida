import { BrowserWorker } from '@effect/platform-browser';
import { Controls, Drawing, Hearing, Photo, Sky, Tab, View, Viewport } from '@egonitida/client';
import { Client, WorkerTransport } from '@egonitida/core';
import { Bridge, Page } from '@egonitida/devtools';
import { Effect, Exit, Option, Scope } from 'effect';
import * as Three from 'three/webgpu';
import * as Baller from '#src/baller.ts';
import * as BallerView from '#src/baller.view.ts';
import * as Camera from '#src/camera.ts';
import * as BallerControls from '#src/controls.ts';
import * as Model from '#src/model.ts';

// The page: joins the local server in a worker as a baller, sends where the sticks place her feet every frame, puts the ball back at a press, and draws her and the ball at every frame the display shows, from where the player turns the camera about her; or, while a photograph of her is taken, holds that moment still and develops it instead, path traced, finer every frame, anew from wherever the player turns the camera.
/** The id the devtools know this page's host by, kept by the tab across reloads, and given to its worker as its name: so the page can say which host it draws, and the worker finds the state kept for the tab. */
const host = Tab.id('baller-trickster');

/** How many paths a photograph follows through every pixel before it is done. */
const SAMPLES = 64;

const main = Effect.gen(function* () {
  const canvas = document.querySelector('canvas');
  const hud = document.querySelector('#hud');
  if (!(canvas instanceof HTMLCanvasElement) || !(hud instanceof HTMLElement)) {
    return yield* Effect.die('The page has no canvas or no HUD.');
  }
  const connection = yield* WorkerTransport.connect;
  const client = yield* Client.connect(connection, { game: Baller.game });
  const drawing = yield* Drawing.make(client, { keepSeconds: 1 });
  // Grounded as a photograph of her is: shaded where little of the sky reaches, such as under her feet and in her kit's folds.
  const viewport = yield* Viewport.make(canvas, {
    ...Viewport.sharp,
    occlusion: Option.some(Viewport.occlusion({ radius: 0.4 })),
  });
  const model = yield* Effect.cached(Model.load);
  // A photograph being developed, the scope it is let go of with, and the moment it is of, drawn still meanwhile so the camera can move about it, while one is.
  const photographing: {
    current: Option.Option<{
      readonly photo: Photo.Photo;
      readonly scope: Scope.Closeable;
      readonly moment: Drawing.Frame;
    }>;
  } = {
    current: Option.none(),
  };
  const drawn = Effect.suspend(() =>
    Option.match(photographing.current, {
      onNone: () => viewport.render,
      onSome: ({ photo }) => photo.develop,
    }),
  );

  const hearing = yield* Hearing.make(window, {});

  // Where the player looks at her from, played on from the sticks every frame.
  // In development, an agent asking through the development server can see what this page draws, and press its keys as the player.
  if (import.meta.env.DEV) {
    yield* Option.match(Bridge.vite, {
      onNone: () => Effect.void,
      onSome: (channel) =>
        Page.serve(channel, {
          host,
          capture: (width) =>
            viewport.capture(width, drawn).pipe(Effect.mapError(({ reason }) => reason)),
          press: (key, frames) => Effect.sync(() => hearing.press(key, frames)),
        }),
    });
  }
  // While a photograph is taken, the camera floats free, and the controls float it rather than play her.
  const played: {
    controls: BallerControls.Read;
    feet: typeof Baller.idle;
    orbit: Camera.Orbit;
    floating: Option.Option<Camera.Floating>;
  } = {
    controls: Controls.start(BallerControls.bindings),
    feet: Baller.idle,
    orbit: Camera.start,
    floating: Option.none(),
  };
  const views = yield* View.make(
    // Every fourth strand of her hair while the game is worked on, so the machine working on it keeps up; every one when it is played.
    BallerView.make(model, import.meta.env.DEV ? 4 : 1).views,
    Option.some({ camera: viewport.camera, player: client.entity }),
    (): Camera.Viewpoint =>
      Option.match(played.floating, {
        onNone: () => ({ _tag: 'Orbiting', orbit: played.orbit }),
        onSome: (floating) => ({ _tag: 'Floating', floating }),
      }),
  );
  const ground = new Three.Mesh(
    new Three.PlaneGeometry(20, 20),
    new Three.MeshStandardNodeMaterial({ color: 0x2f6b34, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  // Lit as a photograph of her is: by the sky all round, which what shines reflects and the photograph's paths leave for, and by the sun, which casts her shadow; developed on a neutral curve, so what the sun lights brightest keeps its colour.
  const sky = Sky.gradient(new Three.Color(0xdde6f0), new Three.Color(0x2b2f33), 2);
  viewport.scene.environment = sky;
  viewport.scene.background = sky;
  viewport.scene.add(views.root, ground);
  viewport.renderer.toneMapping = Three.NeutralToneMapping;
  viewport.renderer.shadowMap.enabled = true;
  viewport.renderer.shadowMap.type = Three.PCFSoftShadowMap;
  const sun = new Three.DirectionalLight(0xffffff, 1.5);
  sun.position.set(2, 4, -3);
  sun.castShadow = true;
  // Her shadow sharp wherever she plays about the middle of the pitch.
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -4;
  sun.shadow.camera.right = 4;
  sun.shadow.camera.top = 4;
  sun.shadow.camera.bottom = -4;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 15;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  viewport.scene.add(sun);
  const help = [
    'left stick or WASD: left foot',
    'right stick or IJKL: right foot',
    'triggers or Q and U: lift them',
    'L3 or R3 held, or Shift: the stick turns the camera',
    'Triangle or R: the ball back',
    'Square or F: the ball dropped onto her foot',
    'directional pad or arrows: walk',
    'Create or P: a photograph, path traced, and back',
    'in a photograph: left stick or WASD floats the camera, right stick or IJKL turns it,',
    '  triggers or Q and U lower and raise it, bumpers or - and + zoom it',
  ].join('\n');
  hud.textContent = help;
  // The help, and while a photograph is developed, how far it has come, written only as it changes.
  const shown = { text: help };
  const tell = (text: string) => {
    if (text !== shown.text) {
      shown.text = text;
      hud.textContent = text;
    }
  };

  yield* viewport.loop((seconds) =>
    Option.match(drawing.frame(seconds), {
      onNone: () => Effect.void,
      onSome: (frame) =>
        Effect.gen(function* () {
          played.controls = Controls.read(BallerControls.bindings, hearing.read(), played.controls);
          const playing = Option.isNone(played.floating);
          if (playing) {
            played.feet = BallerControls.feetOf(played.controls, played.feet);
            played.orbit = Camera.orbit(played.controls, played.orbit, seconds);
          } else {
            played.floating = Option.map(played.floating, (floating) =>
              Camera.float(played.controls, floating, seconds),
            );
          }
          // Her feet held where they were, and her standing still, while the camera floats.
          yield* client.send([
            Baller.Feet.of(played.feet),
            Baller.Walk.of(playing ? BallerControls.walkOf(played.controls) : { x: 0, y: 0 }),
          ]);
          if (playing && BallerControls.replaced(played.controls)) {
            yield* client.act(Baller.ReplacedBall, {});
          }
          if (playing && BallerControls.dropped(played.controls)) {
            yield* client.act(Baller.DroppedBall, {});
          }
          yield* views.frame(
            Option.match(photographing.current, {
              onNone: () => frame,
              onSome: ({ moment }) => moment,
            }),
          );
          if (BallerControls.photographed(played.controls)) {
            photographing.current = yield* Option.match(photographing.current, {
              onNone: () =>
                Effect.gen(function* () {
                  const scope = yield* Scope.make();
                  // Developed as the game is drawn, its noise smoothed away, and done after so many samples.
                  const photo = yield* Scope.provide(
                    Photo.take(viewport, { denoised: true, samples: SAMPLES }),
                    scope,
                  );
                  // Floating from where the camera stands, looking where it looks.
                  const { camera } = viewport;
                  played.floating = Option.some(
                    Camera.floatingFrom(
                      camera.position,
                      camera.getWorldDirection(new Three.Vector3()),
                      camera.fov,
                    ),
                  );
                  return Option.some({ photo, scope, moment: frame });
                }),
              onSome: ({ scope }) =>
                Effect.as(
                  Effect.andThen(
                    Scope.close(scope, Exit.void),
                    Effect.sync(() => {
                      played.floating = Option.none();
                    }),
                  ),
                  Option.none(),
                ),
            });
          }
        }),
    }).pipe(
      Effect.andThen(drawn),
      Effect.andThen(
        Option.match(photographing.current, {
          onNone: () => Effect.sync(() => tell(help)),
          onSome: ({ photo }) =>
            Effect.map(photo.samples, (samples) =>
              tell(
                `${help}\n\nphotograph: ${Math.min(samples, SAMPLES)} of ${SAMPLES} samples${samples >= SAMPLES ? ', done' : ''}`,
              ),
            ),
        }),
      ),
    ),
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
