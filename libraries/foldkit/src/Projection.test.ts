import { BrowserWorkerRunner } from '@effect/platform-browser';
import { describe, expect, it } from '@effect/vitest';
import {
  Action,
  Component,
  Domain,
  Game,
  Rule,
  System,
  WorkerTransport,
  World as Worlds,
} from '@lightocean/core';
import { Effect, Option, Ref, Schema, Stream } from 'effect';
import { ManagedResource } from 'foldkit';
import * as Projection from '#src/Projection.ts';
import * as World from '#src/World.ts';

/** A tally a player adds to, one at a time, and a clock that runs on every step whatever the player does. */
const Tally = Component.make('Tally', Schema.Struct({ count: Schema.Int }), {
  owner: 'rules',
  network: 'server',
});
const Clock = Component.make('Clock', Schema.Struct({ steps: Schema.Int }), {
  owner: 'simulation',
  network: 'server',
});
const Counted = Action.make('Counted', {});
const count = Rule.on(Counted, {
  writes: [Tally],
  emits: [],
  run: (context, { player }) => {
    Option.map(context.get(player, Tally), ({ count }) =>
      context.set(player, Tally, { count: count + 1 }),
    );
  },
});
const ticking = System.make({
  name: 'ticking',
  reads: [],
  writes: [Clock],
  emits: [],
  run: (context) => {
    for (const [entity, { steps }] of context.query(Clock)) {
      context.set(entity, Clock, { steps: steps + 1 });
    }
  },
});
const game = Game.make({
  stepRate: 30,
  domains: [
    Domain.make({
      name: 'Counting',
      requires: [],
      components: [Tally, Clock],
      actions: [Counted],
      events: [],
      systems: [ticking],
      rules: [count],
    }),
  ],
});

/** The game hosted at the far end of a message channel, as a worker would, and joined from the near end. */
const joined = Effect.gen(function* () {
  const channel = new MessageChannel();
  yield* WorkerTransport.serve({
    game,
    world: Worlds.empty({ seed: 1 }),
    join: (world: Worlds.World) =>
      Worlds.spawn(world, [Tally.of({ count: 0 }), Clock.of({ steps: 0 })]),
    leave: Worlds.despawn,
    mayHold: false,
  }).pipe(Effect.provide(BrowserWorkerRunner.layerMessagePort(channel.port2)), Effect.forkScoped);
  return yield* World.join(game, () => channel.port1);
});

/** How many the player has counted, as an application shows it. */
const counted = {
  schema: Schema.Struct({ count: Schema.Int }),
  project: (world: Worlds.World, player: Worlds.Entity) => ({
    count: Option.match(Worlds.get(world, player, Tally), {
      onNone: () => 0,
      onSome: ({ count }) => count,
    }),
  }),
};

describe('a projection', () => {
  // Real time: frames between the two ports travel on the event loop, as they do between a page and its worker.
  it.live(
    'tells what an application shows of the world as it is, then each time it changes, and never while it stays',
    () =>
      Effect.gen(function* () {
        const world = yield* joined;
        const told: Array<{ readonly count: number }> = [];
        yield* Projection.changes(world, counted).pipe(
          Stream.runForEach((value) =>
            Effect.sync(() => {
              told.push(value);
            }),
          ),
          Effect.forkScoped,
        );

        yield* Effect.sleep('200 millis');
        yield* world.client.act(Counted, {});
        yield* Effect.sleep('200 millis');
        yield* world.client.act(Counted, {});
        yield* Effect.sleep('300 millis');
        const clock = Worlds.get(yield* world.client.world, world.client.entity, Clock);

        expect(Option.map(clock, ({ steps }) => steps > 10)).toEqual(Option.some(true));
        expect(told).toEqual([{ count: 0 }, { count: 1 }, { count: 2 }]);
      }).pipe(Effect.scoped),
  );

  it.effect(
    'says the world is not joined, rather than telling nothing, when the Model believes it is but it is not',
    () =>
      Effect.gen(function* () {
        const resource = ManagedResource.tag<World.Joined>()('Tallies');
        const told = yield* Projection.stream({
          ...counted,
          resource,
          onProjected: ({ count }) => `counted ${count}`,
          onNotJoined: () => 'not joined',
        }).pipe(
          Stream.runCollect,
          // As Foldkit holds a resource it has not acquired, such as one a Model restored after a reload says is.
          Effect.provideService(resource._tag, yield* Ref.make(Option.none<World.Joined>())),
        );

        expect(told).toEqual(['not joined']);
      }),
  );
});
