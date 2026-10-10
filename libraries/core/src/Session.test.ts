import { describe, expect, it } from '@effect/vitest';
import { Effect, Exit, Fiber, Option, Schema, Scope, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import * as Action from '#src/Action.ts';
import * as Client from '#src/Client.ts';
import { Controls, Health, Position } from '#src/fixtures.ts';
import * as Game from '#src/Game.ts';
import * as Host from '#src/Host.ts';
import * as Rule from '#src/Rule.ts';
import * as System from '#src/System.ts';
import * as Transport from '#src/Transport.ts';
import * as World from '#src/World.ts';

/** Moves every controlled entity by its stick, at 30 a second. */
const steer = System.make({
  name: 'steer',
  reads: [Controls],
  writes: [Position],
  emits: [],
  run: (context) => {
    for (const [entity, position, controls] of context.query(Position, Controls)) {
      context.set(entity, Position, {
        x: position.x + controls.move * 30 * context.time.stepSeconds,
      });
    }
  },
});

/** A player asked to be healed to an amount; the rules grant it to whoever asked. */
const AskedToHeal = Action.make('AskedToHeal', { amount: Schema.Int });
const heal = Rule.on(AskedToHeal, {
  writes: [Health],
  emits: [],
  run: (context, healed) => {
    context.set(healed.player, Health, { current: healed.amount });
  },
});

const game = Game.make({
  stepRate: 30,
  components: [Position, Controls, Health],
  actions: [AskedToHeal],
  events: [],
  systems: [steer],
  rules: [heal],
});

const hostOptions = (mayHold: boolean): Host.Options => ({
  game,
  world: World.empty({ seed: 1 }),
  join: (world) =>
    World.spawn(world, [
      Position.of({ x: 0 }),
      Controls.of({ move: 0, fire: false }),
      Health.of({ current: 0 }),
    ]),
  leave: World.despawn,
  mayHold,
});

const startHost = Host.make(hostOptions(true));

/** A host and one client joined to it, over a connection in memory. */
const session = Effect.gen(function* () {
  const host = yield* startHost;
  const [clientEnd, hostEnd] = yield* Transport.memoryPair;
  yield* host.connect(hostEnd);
  const client = yield* Client.connect(clientEnd, { game });
  return { host, client, clientEnd };
});

/**
 * Lets `millis` of test time pass the way real time does: a little at a time, giving every fiber its turn. One jump would wake the host's loop once, to find all of it owed at once, as after a stall.
 */
const advance = (millis: number) =>
  Effect.gen(function* () {
    for (let passed = 0; passed < millis; passed += 10) {
      yield* TestClock.adjust(`${Math.min(10, millis - passed)} millis`);
      yield* Effect.yieldNow;
    }
  });

const positionIn = (world: World.World, entity: World.Entity) =>
  Option.map(World.get(world, entity, Position), (position) => position.x);

describe('a session between a host and its clients', () => {
  it.effect('steps the world at its rate as time passes', () =>
    Effect.gen(function* () {
      const host = yield* startHost;

      yield* advance(1000);

      const world = yield* host.world;
      expect(world.tick).toBe(30);
    }),
  );

  it.effect('welcomes a client with the entity it controls', () =>
    Effect.gen(function* () {
      const { host, client } = yield* session;
      const world = yield* host.world;

      expect(positionIn(world, client.entity)).toEqual(Option.some(0));
    }),
  );

  it.effect('moves a client’s entity by the input it sends', () =>
    Effect.gen(function* () {
      const { host, client } = yield* session;

      yield* client.send([Controls.of({ move: 1, fire: false })]);
      yield* advance(100);

      // Three steps of a thirtieth of a second, at 30 a second.
      const world = yield* host.world;
      expect(positionIn(world, client.entity)).toEqual(Option.some(3));
    }),
  );

  it.effect('shows the client the world the host stepped', () =>
    Effect.gen(function* () {
      const { host, client } = yield* session;

      yield* client.send([Controls.of({ move: 1, fire: false })]);
      yield* advance(100);

      const seen = yield* client.world;
      const stepped = yield* host.world;
      expect(seen.tick).toBe(stepped.tick);
      expect(positionIn(seen, client.entity)).toEqual(positionIn(stepped, client.entity));
    }),
  );

  it.effect('ignores what a client sends for anything but input', () =>
    Effect.gen(function* () {
      const { host, client, clientEnd } = yield* session;

      // A client sending a position for itself, as a cheat would.
      yield* clientEnd.send({
        channel: 'unreliable',
        payload: JSON.stringify({ inputs: [{ seq: 99, values: { Position: { x: 999 } } }] }),
      });
      yield* advance(100);

      const world = yield* host.world;
      expect(positionIn(world, client.entity)).toEqual(Option.some(0));
    }),
  );

  it.effect('lets a client go when its connection ends', () =>
    Effect.gen(function* () {
      const host = yield* startHost;
      const [, hostEnd] = yield* Transport.memoryPair;
      const scope = yield* Scope.make();

      const entity = yield* host.connect(hostEnd).pipe(Scope.provide(scope));
      yield* Scope.close(scope, Exit.void);

      const world = yield* host.world;
      expect(positionIn(world, entity)).toEqual(Option.none());
    }),
  );

  it.effect('keeps a held input across steps that bring no new one', () =>
    Effect.gen(function* () {
      const { host, client } = yield* session;

      yield* client.send([Controls.of({ move: -1, fire: false })]);
      yield* advance(1000);

      const world = yield* host.world;
      expect(positionIn(world, client.entity)).toEqual(Option.some(-30));
    }),
  );

  it.effect('tells the client the rate its host steps at', () =>
    Effect.gen(function* () {
      const { client } = yield* session;

      expect(client.stepRate).toBe(30);
    }),
  );

  it.effect('hands on every newer world the client receives, in order', () =>
    Effect.gen(function* () {
      const { client } = yield* session;
      const received = yield* client.worlds.pipe(
        Stream.take(3),
        Stream.runCollect,
        Effect.forkChild,
      );

      yield* advance(200);

      const worlds = yield* Fiber.join(received);
      expect(worlds.map((world) => world.tick)).toEqual([1, 2, 3]);
    }),
  );

  describe('holding time', () => {
    it.effect('holds time while a client asks, where the host allows it', () =>
      Effect.gen(function* () {
        const { host, client } = yield* session;

        yield* client.hold;
        yield* advance(1000);
        const held = yield* host.world;
        expect(held.tick).toBe(0);

        yield* client.release;
        yield* advance(100);
        // Three steps, not the thirty the held second would have owed.
        const resumed = yield* host.world;
        expect(resumed.tick).toBe(3);
      }),
    );

    it.effect('refuses to hold time where the host does not allow it', () =>
      Effect.gen(function* () {
        const host = yield* Host.make(hostOptions(false));
        const [clientEnd, hostEnd] = yield* Transport.memoryPair;
        yield* host.connect(hostEnd);
        const client = yield* Client.connect(clientEnd, { game });

        yield* client.hold;
        yield* advance(1000);

        const world = yield* host.world;
        expect(world.tick).toBe(30);
      }),
    );

    it.effect('lets time go when the client holding it leaves', () =>
      Effect.gen(function* () {
        const host = yield* startHost;
        const [clientEnd, hostEnd] = yield* Transport.memoryPair;
        const scope = yield* Scope.make();
        yield* host.connect(hostEnd).pipe(Scope.provide(scope));
        const client = yield* Client.connect(clientEnd, { game });

        yield* client.hold;
        yield* advance(500);
        yield* Scope.close(scope, Exit.void);
        yield* advance(100);

        const world = yield* host.world;
        expect(world.tick).toBe(3);
      }),
    );
  });

  describe('actions', () => {
    const healthOf = (world: World.World, entity: World.Entity) =>
      Option.map(World.get(world, entity, Health), (health) => health.current);

    it.effect('hands a client’s action to the rules, as from the player who sent it', () =>
      Effect.gen(function* () {
        const { host, client } = yield* session;

        yield* client.act(AskedToHeal, { amount: 50 });
        yield* advance(50);

        const world = yield* host.world;
        expect(healthOf(world, client.entity)).toEqual(Option.some(50));
      }),
    );

    it.effect('keeps a client’s actions in the order it sent them', () =>
      Effect.gen(function* () {
        const { host, client } = yield* session;

        yield* client.act(AskedToHeal, { amount: 50 });
        yield* client.act(AskedToHeal, { amount: 70 });
        yield* advance(50);

        const world = yield* host.world;
        expect(healthOf(world, client.entity)).toEqual(Option.some(70));
      }),
    );

    it.effect('ignores an action the host does not know', () =>
      Effect.gen(function* () {
        const { host, client, clientEnd } = yield* session;

        yield* clientEnd.send({
          channel: 'reliable',
          payload: JSON.stringify({ _tag: 'Act', action: { _tag: 'Teleport', x: 1 } }),
        });
        yield* advance(50);

        const world = yield* host.world;
        expect(healthOf(world, client.entity)).toEqual(Option.some(0));
      }),
    );

    it.effect('carries out an action sent while time is held once it runs again', () =>
      Effect.gen(function* () {
        const { host, client } = yield* session;

        yield* client.hold;
        yield* client.act(AskedToHeal, { amount: 50 });
        yield* advance(500);
        const held = yield* host.world;
        expect(healthOf(held, client.entity)).toEqual(Option.some(0));

        yield* client.release;
        yield* advance(50);
        const resumed = yield* host.world;
        expect(healthOf(resumed, client.entity)).toEqual(Option.some(50));
      }),
    );
  });
});
