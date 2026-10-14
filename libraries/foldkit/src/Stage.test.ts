// @vitest-environment happy-dom
import { BrowserWorkerRunner } from '@effect/platform-browser';
import { describe, expect, it } from '@effect/vitest';
import { Controls, View, type Viewport } from '@lightocean/client';
import {
  Component,
  Domain,
  Game,
  Pointing,
  Rule,
  System,
  WorkerTransport,
  State,
} from '@lightocean/core';
import { Context, Effect, Option, Queue, Ref, Schema, Stream } from 'effect';
import { ManagedResource } from 'foldkit';
import * as Three from 'three/webgpu';
import * as Held from '#src/Held.ts';
import * as Stage from '#src/Stage.ts';
import * as Session from '#src/Session.ts';

/** A lamp a click turns on, and off again. */
const Lamp = Component.make('Lamp', Schema.Struct({ on: Schema.Boolean }), {
  owner: 'rules',
  network: 'server',
});
/** Where a player heads, which the player demands every frame. */
const Heading = Component.make('Heading', Schema.Struct({ angle: Schema.Finite }), {
  owner: 'demand',
  network: 'server',
});
/** Where a player heads, as the game took it: what a step made of their demand. */
const Headed = Component.make('Headed', Schema.Struct({ angle: Schema.Finite }), {
  owner: 'simulation',
  network: 'server',
});
const head = System.make({
  name: 'head',
  reads: [Heading],
  writes: [Headed],
  emits: [],
  run: (context) => {
    for (const [player, heading] of context.query(Heading)) {
      context.set(player, Headed, heading);
    }
  },
});
const toggle = Rule.on(Pointing.Clicked, {
  reads: [],
  writes: [Lamp],
  emits: [],
  run: (context, { entity }) => {
    Option.map(context.get(entity, Lamp), ({ on }) => context.set(entity, Lamp, { on: !on }));
  },
});
const game = Game.make({
  stepRate: 30,
  domains: [
    Pointing.domain,
    Domain.make({
      name: 'Lamps',
      requires: [Pointing.domain],
      components: [Lamp, Heading, Headed],
      actions: [],
      events: [],
      systems: [head],
      rules: [toggle],
    }),
  ],
});

/** Every lamp, as a unit box at the middle of the scene. */
const lamps = View.each([Lamp], {
  acquire: () => Effect.succeed(new Three.Mesh(new Three.BoxGeometry(1, 1, 1))),
  draw: () => {},
});

/** A game with one lamp, off, read out as "Lamp", hosted at the far end of a message channel as a worker would, and joined from the near end. */
const joinedLamp = Effect.gen(function* () {
  const channel = new MessageChannel();
  const [state, lamp] = State.spawn(State.empty({ seed: 1 }), [
    Lamp.of({ on: false }),
    Pointing.Label.of({ text: 'Lamp' }),
  ]);
  yield* WorkerTransport.serve({
    game,
    state,
    join: (joining: State.State) => State.spawn(joining, [Heading.of({ angle: 0 })]),
    leave: State.despawn,
    maySuspend: false,
  }).pipe(Effect.provide(BrowserWorkerRunner.layerMessagePort(channel.port2)), Effect.forkScoped);
  return { lamp, joined: yield* Session.join(game, () => channel.port1) };
});

/** A viewport as a canvas on a display gives one, which plays a frame every twentieth of a second and the clicks a test hands it, and draws, when a frame asks, by bringing where everything is up to date, as a renderer does before it draws. */
const played = Effect.gen(function* () {
  const clicked = yield* Queue.unbounded<{ readonly x: number; readonly y: number }>();
  const scene = new Three.Scene();
  const camera = new Three.PerspectiveCamera();
  const render = Effect.sync(() => {
    scene.updateMatrixWorld();
    camera.updateMatrixWorld();
  });
  const viewport: Viewport.Viewport = {
    canvas: document.createElement('canvas'),
    // Never started, so never drawn with: a stage draws through the viewport alone.
    renderer: new Three.WebGPURenderer(),
    scene,
    camera,
    clicks: Stream.fromQueue(clicked),
    fitted: Stream.empty,
    render,
    lost: Effect.never,
    capture: () => Effect.die('A played viewport takes no shots.'),
    loop: (frame) =>
      Effect.sleep('50 millis').pipe(
        Effect.andThen(Effect.suspend(() => frame(0.05))),
        Effect.forever,
        Effect.forkScoped,
        Effect.asVoid,
      ),
  };
  return {
    viewport,
    click: (point: { readonly x: number; readonly y: number }) => Queue.offer(clicked, point),
  };
});

describe('a stage', () => {
  // Real time: frames between the two ports travel on the event loop, as they do between a page and its worker.
  it.live(
    'shows a game on a viewport, set up as the application asks, where a click or the mirror plays it',
    () =>
      Effect.gen(function* () {
        const { lamp, joined } = yield* joinedLamp;
        const { viewport, click } = yield* played;
        const mirror = document.createElement('div');
        document.body.append(mirror);

        yield* Stage.show(viewport, joined, {
          views: [lamps],
          mirror,
          setup: ({ camera }) => {
            camera.position.set(0, 0, 5);
            camera.lookAt(0, 0, 0);
          },
        });
        yield* Effect.sleep('300 millis');
        yield* click({ x: 0, y: 0 });
        yield* Effect.sleep('300 millis');
        const clickedOn = State.get(yield* joined.client.state, lamp, Lamp);
        mirror.querySelector('button')?.click();
        yield* Effect.sleep('300 millis');
        const pressedOff = State.get(yield* joined.client.state, lamp, Lamp);

        expect(mirror.querySelector('button')?.textContent).toBe('Lamp');
        expect(clickedOn).toEqual(Option.some({ on: true }));
        expect(pressedOff).toEqual(Option.some({ on: false }));
      }).pipe(Effect.scoped),
  );

  it.live(
    'runs what the application asks beside it, given its viewport, until it is shown no more',
    () =>
      Effect.gen(function* () {
        const { joined } = yield* joinedLamp;
        const { viewport } = yield* played;
        const besides: Array<string> = [];

        yield* Stage.show(viewport, joined, {
          views: [lamps],
          mirror: document.createElement('div'),
          alongside: (given) =>
            Effect.acquireRelease(
              Effect.sync(() => {
                besides.push(given === viewport ? 'began on the viewport' : 'began elsewhere');
              }),
              () =>
                Effect.sync(() => {
                  besides.push('ended');
                }),
            ),
        }).pipe(Effect.scoped);

        expect(besides).toEqual(['began on the viewport', 'ended']);
      }).pipe(Effect.scoped),
  );

  it.live("draws the camera for the player who joined, through the views' rigs", () =>
    Effect.gen(function* () {
      const { joined } = yield* joinedLamp;
      const { viewport } = yield* played;
      const backedOff = View.rig([], (camera) => {
        camera.position.set(0, 0, 7);
      });

      yield* Stage.show(viewport, joined, {
        views: [lamps, backedOff],
        mirror: document.createElement('div'),
      });
      yield* Effect.sleep('300 millis');

      expect(viewport.camera.position.z).toBe(7);
    }).pipe(Effect.scoped),
  );

  it.live('needs all that its views need, and what runs beside it, with nothing named', () => {
    const Bell = Context.Service<{ readonly rung: Array<string> }>('Bell');
    const Horn = Context.Service<{ readonly blown: Array<string> }>('Horn');
    const bell = { rung: new Array<string>() };
    const horn = { blown: new Array<string>() };
    const rings = View.on(Lamp, ({ on }) =>
      Effect.gen(function* () {
        (yield* Bell).rung.push(on ? 'on' : 'off');
      }),
    );
    return Effect.gen(function* () {
      const { joined } = yield* joinedLamp;
      const { viewport, click } = yield* played;

      yield* Stage.show(viewport, joined, {
        views: [lamps, rings],
        mirror: document.createElement('div'),
        setup: ({ camera }) => {
          camera.position.set(0, 0, 5);
          camera.lookAt(0, 0, 0);
        },
        alongside: () =>
          Effect.gen(function* () {
            (yield* Horn).blown.push('shown');
          }),
      });
      yield* Effect.sleep('300 millis');
      yield* click({ x: 0, y: 0 });
      yield* Effect.sleep('300 millis');

      expect(bell.rung).toContain('on');
      expect(horn.blown).toEqual(['shown']);
    }).pipe(Effect.scoped, Effect.provideService(Bell, bell), Effect.provideService(Horn, horn));
  });

  it.live(
    "draws through the drawing's input, read again every frame, and never builds its views anew for it",
    () =>
      Effect.gen(function* () {
        const { joined } = yield* joinedLamp;
        const { viewport } = yield* played;
        const looked: { through: 'Eyes' | 'Shoulder' } = { through: 'Eyes' };
        const built: Array<string> = [];
        const counted = View.each([Lamp], {
          acquire: () =>
            Effect.sync(() => {
              built.push('lamp');
              return new Three.Mesh();
            }),
          draw: () => {},
        });
        const looking = View.rig(
          [],
          (camera, _held, _frame, _drawn, through: 'Eyes' | 'Shoulder') => {
            camera.position.set(0, 0, through === 'Eyes' ? 0 : 5);
          },
        );

        yield* Stage.show(viewport, joined, {
          views: [counted, looking],
          mirror: document.createElement('div'),
          input: () => looked.through,
        });
        yield* Effect.sleep('300 millis');
        const throughEyes = viewport.camera.position.z;
        looked.through = 'Shoulder';
        yield* Effect.sleep('300 millis');

        expect(throughEyes).toBeCloseTo(0);
        expect(viewport.camera.position.z).toBeCloseTo(5);
        expect(built).toEqual(['lamp']);
      }).pipe(Effect.scoped),
  );

  it.live(
    "plays the drawing's input on with what the player's devices do, once each frame it draws, before its views draw",
    () =>
      Effect.gen(function* () {
        const { joined } = yield* joinedLamp;
        const { viewport } = yield* played;
        /** Through whose eyes the player looks, as the page keeps it, and how far they turned to the left, as their devices turn them every frame. */
        interface Looked {
          readonly through: 'Eyes' | 'Shoulder';
          readonly yaw: number;
        }
        const looking = View.rig([], (camera, _held, _frame, _drawn, looked: Looked) => {
          camera.position.set(0, 0, looked.through === 'Eyes' ? 0 : 5);
          camera.rotation.set(0, looked.yaw, 0);
        });
        const page: { through: 'Eyes' | 'Shoulder' } = { through: 'Shoulder' };

        yield* Stage.show(viewport, joined, {
          views: [lamps, looking],
          mirror: document.createElement('div'),
          input: () => page.through,
          played: {
            bindings: { turn: Controls.button({ key: 'ArrowLeft' }) },
            start: (through) => ({ through, yaw: 0 }),
            // Turned left at a radian a second while the left arrow is held.
            next: (through, before, controls, seconds) => ({
              through,
              yaw: before.yaw + (controls.values.button('turn').held ? seconds : 0),
            }),
          },
        });
        yield* Effect.sleep('200 millis');
        const before = viewport.camera.rotation.y;
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowLeft' }));
        yield* Effect.sleep('300 millis');
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowLeft' }));
        yield* Effect.sleep('100 millis');
        const turned = viewport.camera.rotation.y;
        yield* Effect.sleep('200 millis');

        expect(before).toBeCloseTo(0);
        expect(turned).toBeGreaterThan(0.15);
        expect(viewport.camera.rotation.y).toBeCloseTo(turned);
        expect(viewport.camera.position.z).toBeCloseTo(5);
      }).pipe(Effect.scoped),
  );

  it.live(
    'reads the controls every frame it draws, so a press is one only when it is new, whatever the page made of the frames before',
    () =>
      Effect.gen(function* () {
        const { joined } = yield* joinedLamp;
        const { viewport } = yield* played;
        /** Whether the page heeds the player yet, and how often they jumped since it did. */
        interface Jumping {
          readonly heeding: boolean;
          readonly jumps: number;
        }
        const counted = View.rig([], (camera, _held, _frame, _drawn, { jumps }: Jumping) => {
          camera.position.y = jumps;
        });
        const page = { heeding: false };

        yield* Stage.show(viewport, joined, {
          views: [lamps, counted],
          mirror: document.createElement('div'),
          input: () => page.heeding,
          played: {
            bindings: { jump: Controls.button({ key: 'Space' }) },
            start: (heeding) => ({ heeding, jumps: 0 }),
            // Not heeding the player, the page makes nothing of the controls.
            next: (heeding, before, controls) => ({
              heeding,
              jumps:
                heeding && controls.values.button('jump').pressed ? before.jumps + 1 : before.jumps,
            }),
          },
        });
        yield* Effect.sleep('150 millis');
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
        yield* Effect.sleep('150 millis');
        page.heeding = true;
        yield* Effect.sleep('150 millis');
        const heldSinceBefore = viewport.camera.position.y;
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }));
        yield* Effect.sleep('150 millis');
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
        yield* Effect.sleep('150 millis');
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }));

        expect(heldSinceBefore).toBeCloseTo(0);
        expect(viewport.camera.position.y).toBeCloseTo(1);
      }).pipe(Effect.scoped),
  );

  it.live(
    "sends the game the demands of each frame it draws, from the drawing's input and the controls, such as where the player heads",
    () =>
      Effect.gen(function* () {
        const { joined } = yield* joinedLamp;
        const { viewport } = yield* played;
        const facing = View.rig(
          [],
          (camera, _held, _frame, _drawn, { yaw }: { readonly yaw: number }) => {
            camera.rotation.y = yaw;
          },
        );

        yield* Stage.show(viewport, joined, {
          views: [lamps, facing],
          mirror: document.createElement('div'),
          input: () => 0.5,
          played: {
            bindings: { ahead: Controls.button({ key: 'KeyW' }) },
            start: (yaw) => ({ yaw }),
            next: (yaw) => ({ yaw }),
            // Heading where the camera faces while the player walks ahead, and nowhere else.
            demands: ({ yaw }, controls) =>
              controls.values.button('ahead').held ? [Heading.of({ angle: yaw })] : [],
          },
        });
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
        yield* Effect.sleep('400 millis');
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
        const headed = State.get(yield* joined.client.state, joined.client.entity, Headed);

        expect(Option.map(headed, ({ angle }) => angle)).toEqual(Option.some(0.5));
      }).pipe(Effect.scoped),
  );

  describe('as a Foldkit Subscription entry', () => {
    /** A page's Model: whether its canvas is there to show the game on, and through whose eyes its player looks. */
    interface Model {
      readonly isShown: boolean;
      readonly looking: 'Eyes' | 'Shoulder';
    }
    const Looking = Schema.Literals(['Eyes', 'Shoulder']);
    const looking = View.rig([], (camera, _held, _frame, _drawn, through: 'Eyes' | 'Shoulder') => {
      camera.position.set(0, 0, through === 'Eyes' ? 0 : 5);
    });
    const resource = ManagedResource.tag<Session.Joined>()('Looked');
    const entry = Stage.entry({
      resource,
      canvasId: 'nowhere',
      views: [lamps, looking],
      shows: (model: Model) => model.isShown,
      input: { schema: Looking, of: (model: Model) => model.looking },
      onNotJoined: () => 'not joined',
      onFailed: (reason) => `failed: ${reason}`,
    });

    it('follows the input from the Model, keeping the stage while it is shown however the input changes', () => {
      const throughEyes = entry.modelToDependencies({ isShown: true, looking: 'Eyes' });
      const overShoulder = entry.modelToDependencies({ isShown: true, looking: 'Shoulder' });
      const hidden = entry.modelToDependencies({ isShown: false, looking: 'Eyes' });

      expect(overShoulder).toEqual({ isShown: true, input: 'Shoulder' });
      expect(Schema.is(entry.dependenciesSchema)(overShoulder)).toBe(true);
      expect(entry.keepAliveEquivalence(throughEyes, overShoulder)).toBe(true);
      expect(entry.keepAliveEquivalence(throughEyes, hidden)).toBe(false);
    });

    it.effect('shows nothing while the Model says the stage is not shown', () =>
      Effect.gen(function* () {
        const hidden = entry.modelToDependencies({ isShown: false, looking: 'Eyes' });

        const told = yield* entry
          .dependenciesToStream(hidden, () => hidden)
          .pipe(
            Stream.runCollect,
            Held.holding(resource, yield* Ref.make(Option.none<Session.Joined>())),
          );

        expect(told).toEqual([]);
      }),
    );
  });

  it.effect(
    'says the session is not joined, rather than failing, when the Model believes it is but it is not',
    () =>
      Effect.gen(function* () {
        const resource = ManagedResource.tag<Session.Joined>()('Lamps');
        const told = yield* Stage.stream({
          resource,
          canvasId: 'nowhere',
          views: [lamps],
          onNotJoined: () => 'not joined',
          onFailed: (reason) => `failed: ${reason}`,
        }).pipe(
          Stream.runCollect,
          // As Foldkit holds a resource it has not acquired, such as one a Model restored after a reload says is.
          Held.holding(resource, yield* Ref.make(Option.none<Session.Joined>())),
        );

        expect(told).toEqual(['not joined']);
      }),
  );

  describe('run by a page that draws it itself', () => {
    it.live('gives the page the session and its element, and passes on what the page says', () =>
      Effect.gen(function* () {
        const { joined } = yield* joinedLamp;
        const resource = ManagedResource.tag<Session.Joined>()('Drawn');
        const element = document.createElement('div');
        element.id = 'scene';
        document.body.append(element);

        const told = yield* Stage.run({
          resource,
          elementId: 'scene',
          show: (given, at) =>
            Stream.make(
              `${at.id} shows the game of ${given.client.entity === joined.client.entity ? 'this' : 'another'} player`,
            ),
          onNotJoined: () => 'not joined',
          onFailed: (reason) => `failed: ${reason}`,
        }).pipe(Stream.runCollect, Held.holding(resource, yield* Ref.make(Option.some(joined))));

        element.remove();
        expect(told).toEqual(['scene shows the game of this player']);
      }).pipe(Effect.scoped),
    );

    it.live('says why when there is no element to draw on, or the drawing fails', () =>
      Effect.gen(function* () {
        const { joined } = yield* joinedLamp;
        const resource = ManagedResource.tag<Session.Joined>()('Drawn');
        const element = document.createElement('div');
        element.id = 'failing';
        document.body.append(element);
        const runOn = (elementId: string) =>
          Stage.run({
            resource,
            elementId,
            show: () => Stream.fail(new Stage.Unshown({ reason: 'No GPU.' })),
            onNotJoined: () => 'not joined',
            onFailed: (reason) => `failed: ${reason}`,
          }).pipe(Stream.runCollect);

        const told = yield* Effect.all([runOn('nowhere'), runOn('failing')]).pipe(
          Held.holding(resource, yield* Ref.make(Option.some(joined))),
        );

        element.remove();
        expect(told).toEqual([
          ['failed: There is no element with the id nowhere.'],
          ['failed: No GPU.'],
        ]);
      }).pipe(Effect.scoped),
    );

    it.effect('says the session is not joined, as a stage does', () =>
      Effect.gen(function* () {
        const resource = ManagedResource.tag<Session.Joined>()('Drawn');
        const told = yield* Stage.run({
          resource,
          elementId: 'scene',
          show: () => Stream.make('shown'),
          onNotJoined: () => 'not joined',
          onFailed: (reason) => `failed: ${reason}`,
        }).pipe(
          Stream.runCollect,
          Held.holding(resource, yield* Ref.make(Option.none<Session.Joined>())),
        );

        expect(told).toEqual(['not joined']);
      }),
    );
  });
});
