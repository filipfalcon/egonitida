import { BrowserWorker, BrowserWorkerRunner } from '@effect/platform-browser';
import { describe, expect, it } from '@effect/vitest';
import {
  Action,
  Client,
  Command,
  Component,
  Domain,
  Event,
  Game,
  Host,
  Rule,
  System,
  WorkerTransport,
  World,
} from '@lightocean/core';
import { Context, Effect, Fiber, Option, Schema, Stream } from 'effect';

const Position = Component.make('Position', Schema.Struct({ x: Schema.Finite }), {
  owner: 'simulation',
  network: 'predicted',
});
const Controls = Component.make('Controls', Schema.Struct({ move: Schema.Finite }), {
  owner: 'input',
  network: 'predicted',
});

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

const game = Game.make({
  stepRate: 30,
  domains: [
    Domain.make({
      name: 'Test',
      requires: [],
      components: [Position, Controls],
      actions: [],
      events: [],
      systems: [steer],
      rules: [],
    }),
  ],
});

const hostOptions = {
  game,
  world: World.empty({ seed: 1 }),
  join: (world: World.World) =>
    World.spawn(world, [Position.of({ x: 0 }), Controls.of({ move: 0 })]),
  leave: World.despawn,
  // A local server for one player lets that player hold time.
  mayHold: true,
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
      const client = yield* Client.connect(connection, { game });
      yield* client.send([Controls.of({ move: 1 })]);
      yield* Effect.sleep('300 millis');

      const world = yield* client.world;
      const moved = Option.map(World.get(world, client.entity, Position), (position) => position.x);
      expect(world.tick).toBeGreaterThan(0);
      expect(Option.getOrElse(moved, () => 0)).toBeGreaterThan(0);
    }),
  );

  it.live('runs the commands its rules issue with the services it is given', () =>
    Effect.gen(function* () {
      const said: Array<string> = [];
      /** Where a greeting goes outside the world; this one keeps what it was told. */
      const Mouth = Context.Service<{ readonly say: (words: string) => Effect.Effect<void> }>(
        'Mouth',
      );
      const Waved = Action.make('Waved', {});
      const Greeted = Event.make('Greeted', { player: Schema.Int });
      const Greet = Command.make('Greet', {
        args: { player: Schema.Int },
        results: [Greeted],
        execute: ({ player }) =>
          Effect.gen(function* () {
            yield* (yield* Mouth).say(`hello, ${player}`);
            const greeted: Event.ValueOf<typeof Greeted> = { _tag: 'Greeted', player };
            return greeted;
          }),
      });
      const greet = Rule.on(Waved, {
        writes: [],
        emits: [],
        commands: [Greet],
        run: (context, waved) => {
          context.command(Greet.of({ player: waved.player }));
        },
      });
      const polite = Game.make({
        stepRate: 30,
        domains: [
          Domain.make({
            name: 'Polite',
            requires: [],
            components: [Position, Controls],
            actions: [Waved],
            events: [Greeted],
            commands: [Greet],
            systems: [],
            rules: [greet],
          }),
        ],
      });
      const channel = new MessageChannel();

      yield* WorkerTransport.serve({ ...hostOptions, game: polite }).pipe(
        Effect.provide(BrowserWorkerRunner.layerMessagePort(channel.port2)),
        Effect.provideService(Mouth, {
          say: (words) =>
            Effect.sync(() => {
              said.push(words);
            }),
        }),
        Effect.forkScoped,
      );
      const connection = yield* WorkerTransport.connect.pipe(
        Effect.provide(BrowserWorker.layer(() => channel.port1)),
      );
      const client = yield* Client.connect(connection, { game: polite });
      yield* client.act(Waved, {});
      yield* Effect.sleep('300 millis');

      expect(said).toEqual([`hello, ${client.entity}`]);
    }),
  );

  it.live('serves a host made beforehand, which the worker may watch as it serves', () =>
    Effect.gen(function* () {
      const channel = new MessageChannel();
      const host = yield* Host.make(hostOptions);
      const watching = yield* host.watch;
      const joined = yield* watching.happenings.pipe(
        Stream.take(1),
        Stream.runHead,
        Effect.forkChild,
      );

      yield* WorkerTransport.serveHost(host).pipe(
        Effect.provide(BrowserWorkerRunner.layerMessagePort(channel.port2)),
        Effect.forkScoped,
      );
      const connection = yield* WorkerTransport.connect.pipe(
        Effect.provide(BrowserWorker.layer(() => channel.port1)),
      );
      const client = yield* Client.connect(connection, { game });

      expect(yield* Fiber.join(joined)).toEqual(
        Option.some({ _tag: 'Joined', entity: client.entity, client: true }),
      );
    }),
  );
});
