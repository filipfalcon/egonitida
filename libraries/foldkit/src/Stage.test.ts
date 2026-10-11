// @vitest-environment happy-dom
import { BrowserWorkerRunner } from '@effect/platform-browser';
import { describe, expect, it } from '@effect/vitest';
import { View, type Viewport } from '@lightocean/client';
import {
  Component,
  Domain,
  Game,
  Pointing,
  Rule,
  WorkerTransport,
  World as Worlds,
} from '@lightocean/core';
import { Effect, Option, Queue, Ref, Schema, Stream } from 'effect';
import { ManagedResource } from 'foldkit';
import * as Three from 'three/webgpu';
import * as Stage from '#src/Stage.ts';
import * as World from '#src/World.ts';

/** A lamp a click turns on, and off again. */
const Lamp = Component.make('Lamp', Schema.Struct({ on: Schema.Boolean }), {
  owner: 'rules',
  network: 'server',
});
const toggle = Rule.on(Pointing.Clicked, {
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
      components: [Lamp],
      actions: [],
      events: [],
      systems: [],
      rules: [toggle],
    }),
  ],
});

/** Every lamp, as a unit box at the middle of the world. */
const lamps = View.each([Lamp], {
  acquire: () => Effect.succeed(new Three.Mesh(new Three.BoxGeometry(1, 1, 1))),
  draw: () => {},
});

/** A world with one lamp, off, read out as "Lamp", hosted at the far end of a message channel as a worker would, and joined from the near end. */
const joinedLamp = Effect.gen(function* () {
  const channel = new MessageChannel();
  const [world, lamp] = Worlds.spawn(Worlds.empty({ seed: 1 }), [
    Lamp.of({ on: false }),
    Pointing.Label.of({ text: 'Lamp' }),
  ]);
  yield* WorkerTransport.serve({
    game,
    world,
    join: (joining: Worlds.World) => Worlds.spawn(joining, []),
    leave: Worlds.despawn,
    mayHold: false,
  }).pipe(Effect.provide(BrowserWorkerRunner.layerMessagePort(channel.port2)), Effect.forkScoped);
  return { lamp, joined: yield* World.join(game, () => channel.port1) };
});

/** A viewport as a canvas on a display gives one, which plays a frame every twentieth of a second and the clicks a test hands it, and draws by bringing where everything is up to date, as a renderer does before it draws. */
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
    scene,
    camera,
    clicks: Stream.fromQueue(clicked),
    render,
    capture: () => Effect.die('A played viewport takes no shots.'),
    loop: (frame) =>
      Effect.sleep('50 millis').pipe(
        Effect.andThen(Effect.suspend(() => frame(0.05))),
        Effect.andThen(render),
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
    'shows a world on a viewport, set up as the application asks, where a click or the mirror plays it',
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
        const clickedOn = Worlds.get(yield* joined.client.world, lamp, Lamp);
        mirror.querySelector('button')?.click();
        yield* Effect.sleep('300 millis');
        const pressedOff = Worlds.get(yield* joined.client.world, lamp, Lamp);

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

  it.effect(
    'says the world is not joined, rather than failing, when the Model believes it is but it is not',
    () =>
      Effect.gen(function* () {
        const resource = ManagedResource.tag<World.Joined>()('Lamps');
        const told = yield* Stage.stream({
          resource,
          canvasId: 'nowhere',
          views: [lamps],
          onNotJoined: () => 'not joined',
          onFailed: (reason) => `failed: ${reason}`,
        }).pipe(
          Stream.runCollect,
          // As Foldkit holds a resource it has not acquired, such as one a Model restored after a reload says is.
          Effect.provideService(resource._tag, yield* Ref.make(Option.none<World.Joined>())),
        );

        expect(told).toEqual(['not joined']);
      }),
  );
});
