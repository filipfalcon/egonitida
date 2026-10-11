import { describe, expect, it } from '@effect/vitest';
import { type Client, Component, Pointing, World } from '@lightocean/core';
import { Effect, Option, Queue, Schema, Stream } from 'effect';
import * as Three from 'three/webgpu';
import * as Clicking from '#src/Clicking.ts';
import * as Drawing from '#src/Drawing.ts';
import * as Timeline from '#src/Timeline.ts';
import * as View from '#src/View.ts';

const Spot = Component.make('Spot', Schema.Struct({ x: Schema.Finite, z: Schema.Finite }), {
  owner: 'rules',
  network: 'server',
});

/** Everything at a spot, as a unit box there. */
const boxes = View.each([Spot], {
  acquire: () => Effect.succeed(new Three.Mesh(new Three.BoxGeometry(1, 1, 1))),
  draw: (box, held) => {
    box.position.set(held(Spot).x, 0, held(Spot).z);
  },
});

/** A camera five units back, looking at the middle. */
const camera = new Three.PerspectiveCamera(50, 1, 0.1, 100);
camera.position.set(0, 0, 5);
camera.lookAt(0, 0, 0);

/** A labelled box in the middle with a box with no label in front of it, a labelled box to the right, and the actions a client took for clicks. */
const clicked = (points: ReadonlyArray<{ readonly x: number; readonly y: number }>) =>
  Effect.gen(function* () {
    const [one, middle] = World.spawn(World.empty({ seed: 1 }), [
      Spot.of({ x: 0, z: 0 }),
      Pointing.Label.of({ text: 'Middle box' }),
    ]);
    const [two, right] = World.spawn(one, [
      Spot.of({ x: 1.5, z: 0 }),
      Pointing.Label.of({ text: 'Right box' }),
    ]);
    const [world] = World.spawn(two, [Spot.of({ x: 0, z: 2 })]);
    const views = yield* View.make([boxes]);
    yield* views.frame(Drawing.frameOf(Timeline.still(world), Option.none()));
    const acted: Array<unknown> = [];
    const client: Pick<Client.Client, 'world' | 'act'> = {
      world: Effect.succeed(world),
      act: (action, value) =>
        Effect.sync(() => {
          acted.push(action.encode(value));
        }),
    };
    const clicks = yield* Queue.unbounded<{ readonly x: number; readonly y: number }>();
    yield* Clicking.serve({ clicks: Stream.fromQueue(clicks), camera, views, client });
    yield* Effect.forEach(points, (point) => Queue.offer(clicks, point), { discard: true });
    yield* Effect.yieldNow;
    return { acted, middle, right };
  });

describe('clicking', () => {
  it.effect('acts a click on the labelled entity under the pointer', () =>
    Effect.gen(function* () {
      const toTheRight = new Three.Vector3(1.6, 0.3, 0).project(camera);
      const { acted, right } = yield* clicked([{ x: toTheRight.x, y: toTheRight.y }]);

      expect(acted).toEqual([{ _tag: 'Clicked', entity: right }]);
    }),
  );

  it.effect('acts nothing for a click on nothing, or on an entity with no label in front', () =>
    Effect.gen(function* () {
      const { acted } = yield* clicked([
        { x: -0.9, y: 0.9 },
        { x: 0, y: 0 },
      ]);

      expect(acted).toEqual([]);
    }),
  );
});
