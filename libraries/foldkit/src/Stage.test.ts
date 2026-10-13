// @vitest-environment happy-dom
import { BrowserWorkerRunner } from '@effect/platform-browser';
import { describe, expect, it } from '@effect/vitest';
import { View, type Viewport } from '@lightocean/client';
import { Component, Domain, Game, Pointing, Rule, WorkerTransport, State } from '@lightocean/core';
import { Effect, Option, Queue, Ref, Schema, Stream } from 'effect';
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
      components: [Lamp],
      actions: [],
      events: [],
      systems: [],
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
    join: (joining: State.State) => State.spawn(joining, []),
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
