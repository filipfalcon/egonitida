import { BrowserWorker, BrowserWorkerRunner } from '@effect/platform-browser';
import { describe, expect, it } from '@effect/vitest';
import { Client, Component, Game, System, WorkerTransport, World } from '@lightocean/core';
import { Effect, Option, Schema } from 'effect';

const Position = Component.make('Position', Schema.Struct({ x: Schema.Finite }), {
  owner: 'simulation',
  network: 'predicted',
});
const Controls = Component.make('Controls', Schema.Struct({ move: Schema.Finite }), {
  owner: 'input',
  network: 'predicted',
});
const components = [Position, Controls];

const steer = System.make({
  name: 'steer',
  reads: [Controls],
  writes: [Position],
  emits: [],
  run: (context) => {
    for (const [entity, position, controls] of context.query(Position, Controls)) {
      context.set(entity, Position, { x: position.x + controls.move });
    }
  },
});

const hostOptions = {
  game: Game.make({ stepRate: 30, systems: [steer], rules: [] }),
  world: World.empty({ seed: 1 }),
  components,
  join: (world: World.World) =>
    World.spawn(world, [Position.of({ x: 0 }), Controls.of({ move: 0 })]),
  leave: World.despawn,
  // A local server for one player lets that player hold time.
  mayHold: true,
  actions: [],
};

describe('a local server', () => {
  // Real time: messages between the two ports travel on the event loop, as they do between a page and its worker.
  it.live('hosts a session across a message channel, as between a page and its worker', () =>
    Effect.gen(function* () {
      const channel = new MessageChannel();

      // The worker's side.
      yield* WorkerTransport.serve(hostOptions).pipe(
        Effect.provide(BrowserWorkerRunner.layerMessagePort(channel.port2)),
        Effect.forkScoped,
      );

      // The page's side.
      const connection = yield* WorkerTransport.connect.pipe(
        Effect.provide(BrowserWorker.layer(() => channel.port1)),
      );
      const client = yield* Client.connect(connection, { components });
      yield* client.send([Controls.of({ move: 1 })]);
      yield* Effect.sleep('300 millis');

      const world = yield* client.world;
      const moved = Option.map(World.get(world, client.entity, Position), (position) => position.x);
      expect(world.tick).toBeGreaterThan(0);
      expect(Option.getOrElse(moved, () => 0)).toBeGreaterThan(0);
    }),
  );
});
