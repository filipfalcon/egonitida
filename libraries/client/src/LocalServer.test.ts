import { BrowserWorker, BrowserWorkerRunner } from '@effect/platform-browser';
import { describe, expect, it } from '@effect/vitest';
import {
  Action,
  Client,
  Command,
  Component,
  Domain,
  Game,
  Host,
  Rule,
  System,
  WorkerTransport,
  State,
} from '@egonitida/core';
import { Context, Effect, Fiber, Option, Schema, Stream } from 'effect';

const Position = Component.make('Position', Schema.Struct({ x: Schema.Finite }), {
  owner: 'simulation',
  network: 'predicted',
});
const Controls = Component.make('Controls', Schema.Struct({ move: Schema.Finite }), {
  owner: 'demand',
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
  state: State.empty({ seed: 1 }),
  join: (state: State.State) =>
    State.spawn(state, [Position.of({ x: 0 }), Controls.of({ move: 0 })]),
  leave: State.despawn,
  // A local server for one player lets that player suspend time.
  maySuspend: true,
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

      const state = yield* client.state;
      const moved = Option.map(State.get(state, client.entity, Position), (position) => position.x);
      expect(state.tick).toBeGreaterThan(0);
      expect(Option.getOrElse(moved, () => 0)).toBeGreaterThan(0);
    }),
  );

  it.live('runs the commands its rules issue with the services it is given', () =>
    Effect.gen(function* () {
      const said: Array<string> = [];
      /** Where a greeting goes outside the state; this one keeps what it was told. */
      const Mouth = Context.Service<{ readonly say: (words: string) => Effect.Effect<void> }>(
        'Mouth',
      );
      const Waved = Action.make('Waved', {});
      const Greeted = Command.result('Greeted', { player: Schema.Int });
      const Greet = Command.make('Greet', {
        args: { player: Schema.Int },
        results: [Greeted],
        execute: ({ player }) =>
          Effect.gen(function* () {
            yield* (yield* Mouth).say(`hello, ${player}`);
            const greeted: Rule.ValueOf<typeof Greeted> = { _tag: 'Greeted', player };
            return greeted;
          }),
      });
      const greet = Rule.on(Waved, {
        reads: [],
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
            events: [],
            commands: [Greet],
            systems: [],
            // Nothing more comes of a greeting once it is said.
            rules: [greet, Rule.on(Greeted, { reads: [], writes: [], emits: [], run: () => {} })],
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

  it.live(
    'makes its host from what the page opens with, as a page hands a worker where to start',
    () =>
      Effect.gen(function* () {
        const channel = new MessageChannel();
        /** A state whose one player stands where the page said, opening with a number. */
        const startingAt = (opening: string) =>
          Host.make({
            ...hostOptions,
            join: (state: State.State) =>
              State.spawn(state, [Position.of({ x: Number(opening) }), Controls.of({ move: 0 })]),
          });

        yield* WorkerTransport.serveOpened(startingAt).pipe(
          Effect.provide(BrowserWorkerRunner.layerMessagePort(channel.port2)),
          Effect.forkScoped,
        );
        const connection = yield* WorkerTransport.connectOpening('7').pipe(
          Effect.provide(BrowserWorker.layer(() => channel.port1)),
        );
        const client = yield* Client.connect(connection, { game });
        yield* Effect.sleep('200 millis');

        expect(State.get(yield* client.state, client.entity, Position)).toEqual(
          Option.some({ x: 7 }),
        );
      }),
  );
});
