import { BrowserWorkerRunner } from '@effect/platform-browser';
import { describe, expect, it } from '@effect/vitest';
import {
  Action,
  Component,
  Domain,
  Game,
  Host,
  Rule,
  WorkerTransport,
  World as Worlds,
} from '@lightocean/core';
import { Effect, Option, Schema } from 'effect';
import { ManagedResource } from 'foldkit';
import * as World from '#src/World.ts';

/** A tally a player adds to, one at a time. */
const Tally = Component.make('Tally', Schema.Struct({ count: Schema.Int }), {
  owner: 'rules',
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
const game = Game.make({
  stepRate: 30,
  domains: [
    Domain.make({
      name: 'Counting',
      requires: [],
      components: [Tally],
      actions: [Counted],
      events: [],
      systems: [],
      rules: [count],
    }),
  ],
});

/** Hosts the game at the far end of a message channel, as a worker would, and gives the near end, as a page starts a worker. */
const hosted = Effect.gen(function* () {
  const channel = new MessageChannel();
  yield* WorkerTransport.serve({
    game,
    world: Worlds.empty({ seed: 1 }),
    join: (world: Worlds.World) => Worlds.spawn(world, [Tally.of({ count: 0 })]),
    leave: Worlds.despawn,
    mayHold: false,
  }).pipe(Effect.provide(BrowserWorkerRunner.layerMessagePort(channel.port2)), Effect.forkScoped);
  return () => channel.port1;
});

/** What an application's Model says of the world here: whether it wants it joined. */
interface Model {
  readonly playing: boolean;
}
type Message =
  | { readonly _tag: 'Joined' }
  | { readonly _tag: 'Left' }
  | { readonly _tag: 'FailedToJoin'; readonly reason: string };

describe('a world from Foldkit', () => {
  // Real time: frames between the two ports travel on the event loop, as they do between a page and its worker.
  it.live('is joined in a worker, played through its client, and drawn', () =>
    Effect.gen(function* () {
      const worker = yield* hosted;

      const joined = yield* World.join(game, worker);
      yield* joined.client.act(Counted, {});
      yield* Effect.sleep('300 millis');

      const tally = Worlds.get(yield* joined.client.world, joined.client.entity, Tally);
      expect(Option.map(tally, ({ count }) => count)).toEqual(Option.some(1));
      expect(Option.isSome(joined.drawing.frame(0.3))).toBe(true);
    }).pipe(Effect.scoped),
  );

  it.live("is joined while the application's Model wants it, and says so in its Messages", () =>
    Effect.gen(function* () {
      const worker = yield* hosted;
      const managed = World.managed({
        resource: ManagedResource.tag<World.Joined>()('World'),
        game,
        worker,
        joins: ({ playing }: Model) => playing,
        onJoined: (): Message => ({ _tag: 'Joined' }),
        onLeft: (): Message => ({ _tag: 'Left' }),
        onFailed: (reason): Message => ({ _tag: 'FailedToJoin', reason }),
      });
      // Foldkit takes it as one of an application's Managed Resources.
      ManagedResource.make<Model, Message>()((entry) => ({
        world: entry(World.Requirements, managed),
      }));

      const joined = yield* managed.acquire();

      expect(managed.modelToMaybeRequirements({ playing: true })).toEqual(Option.some(null));
      expect(managed.modelToMaybeRequirements({ playing: false })).toEqual(Option.none());
      expect(joined.client.stepRate).toBe(30);
      expect(managed.onAcquired(joined)).toEqual({ _tag: 'Joined' });
      expect(managed.onReleased()).toEqual({ _tag: 'Left' });
      expect(managed.onAcquireError(new Error('no worker'))).toEqual({
        _tag: 'FailedToJoin',
        reason: 'no worker',
      });
    }).pipe(Effect.scoped),
  );

  it.live('is opened with what the Model holds, which the worker makes its host from', () =>
    Effect.gen(function* () {
      const channel = new MessageChannel();
      yield* WorkerTransport.serveOpened((opening) =>
        Host.make({
          game,
          world: Worlds.empty({ seed: 1 }),
          join: (world: Worlds.World) =>
            Worlds.spawn(world, [Tally.of({ count: Number(opening) })]),
          leave: Worlds.despawn,
          mayHold: false,
        }),
      ).pipe(
        Effect.provide(BrowserWorkerRunner.layerMessagePort(channel.port2)),
        Effect.forkScoped,
      );
      const opened = World.opened({
        resource: ManagedResource.tag<World.Joined>()('Counting'),
        game,
        worker: () => channel.port1,
        opens: ({ startingAt }: { readonly startingAt: Option.Option<string> }) => startingAt,
        onJoined: () => 'joined',
        onLeft: () => 'left',
        onFailed: (reason) => reason,
      });

      const joined = yield* opened.acquire('5');
      yield* Effect.sleep('200 millis');

      expect(opened.modelToMaybeRequirements({ startingAt: Option.some('5') })).toEqual(
        Option.some('5'),
      );
      expect(
        Option.map(
          Worlds.get(yield* joined.client.world, joined.client.entity, Tally),
          ({ count }) => count,
        ),
      ).toEqual(Option.some(5));
    }).pipe(Effect.scoped),
  );
});
