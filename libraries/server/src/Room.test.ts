import { describe, expect, it } from '@effect/vitest';
import { Client, Component, Domain, Game, World } from '@lightocean/core';
import { SocketTransport } from '@lightocean/core/experimental';
import { type Cause, Effect, Option, Queue, Schema } from 'effect';
import * as Socket from 'effect/socket/Socket';
import * as Room from '#src/Room.ts';

/** Whoever is in the room: an entity holding nothing but that it is someone. */
const Someone = Component.make('Someone', Schema.Struct({}), {
  owner: 'rules',
  network: 'server',
});
const game = Game.make({
  stepRate: 30,
  domains: [
    Domain.make({
      name: 'Room',
      requires: [],
      components: [Someone],
      actions: [],
      events: [],
      systems: [],
      rules: [],
    }),
  ],
});
const options = {
  game,
  world: World.empty({ seed: 1 }),
  join: (world: World.World) => World.spawn(world, [Someone.of({})]),
  leave: World.despawn,
  mayHold: false,
};

/** A player in `room` over a socket in memory, as a page reaches a Durable Object over a WebSocket: the room's side opened, and the client joined over the page's side. */
const entered = (room: Room.Room) =>
  Effect.gen(function* () {
    const toPage = yield* Queue.unbounded<string, Cause.Done>();
    const opened = yield* room.open({
      send: (text) => Queue.offer(toPage, text).pipe(Effect.asVoid),
    });
    const socket = Socket.make({
      reader: Effect.succeed({
        pull: Queue.take(toPage).pipe(
          Effect.map((text): readonly [string] => [text]),
          Effect.mapError(
            () => new Socket.SocketError({ reason: new Socket.SocketCloseError({ code: 1000 }) }),
          ),
        ),
        upgrade: () => Effect.void,
      }),
      writer: Effect.succeed({
        write: (chunk) => (typeof chunk === 'string' ? opened.received(chunk) : Effect.void),
        writeAll: (chunks) =>
          Effect.forEach(chunks, (chunk) =>
            typeof chunk === 'string' ? opened.received(chunk) : Effect.void,
          ).pipe(Effect.asVoid),
      }),
    });
    const client = yield* Client.connect(yield* SocketTransport.fromSocket(socket), { game });
    return { client, opened };
  });

/** Who is in the world `client` sees now. */
const someone = (client: Client.Client) =>
  Effect.map(client.world, (world) => World.holding(world, [Someone]));

describe('a room', () => {
  // Real time: a room steps its world as time passes, as a Durable Object does.
  it.live('hosts a game for every socket that opens, as one player each', () =>
    Effect.gen(function* () {
      const room = yield* Room.make(options);

      const first = yield* entered(room);
      const second = yield* entered(room);
      yield* Effect.sleep('200 millis');

      expect(first.client.entity).not.toBe(second.client.entity);
      expect(yield* someone(first.client)).toEqual([first.client.entity, second.client.entity]);
    }).pipe(Effect.scoped),
  );

  it.live('lets go of a player whose socket closes', () =>
    Effect.gen(function* () {
      const room = yield* Room.make(options);
      const staying = yield* entered(room);
      const going = yield* entered(room);

      yield* going.opened.closed;
      yield* Effect.sleep('200 millis');

      expect(yield* someone(staying.client)).toEqual([staying.client.entity]);
    }).pipe(Effect.scoped),
  );

  it.live('stands still while no one is in it, and runs while someone is', () =>
    Effect.gen(function* () {
      const room = yield* Room.make(options);
      const tick = Effect.map(room.host.world, ({ tick }) => tick);

      yield* Effect.sleep('200 millis');
      const empty = yield* tick;
      const { opened } = yield* entered(room);
      yield* Effect.sleep('200 millis');
      const entering = yield* tick;
      yield* opened.closed;
      const left = yield* tick;
      yield* Effect.sleep('200 millis');

      expect(empty).toBe(0);
      expect(entering).toBeGreaterThan(0);
      expect(yield* tick).toBe(left);
    }).pipe(Effect.scoped),
  );

  it.live('runs for a player who enters while the last one is still leaving', () =>
    Effect.gen(function* () {
      const room = yield* Room.make(options);
      const tick = Effect.map(room.host.world, ({ tick }) => tick);
      const runs: Array<boolean> = [];

      // One leaves and the next enters at once, again and again, as a page reconnecting does.
      const first = yield* entered(room);
      const leaving = { opened: first.opened };
      for (let round = 0; round < 10; round += 1) {
        const [, next] = yield* Effect.all([leaving.opened.closed, entered(room)], {
          concurrency: 'unbounded',
        });
        leaving.opened = next.opened;
        const before = yield* tick;
        yield* Effect.sleep('100 millis');
        runs.push((yield* tick) > before);
      }

      expect(runs).toEqual(Array.from({ length: 10 }, () => true));
    }).pipe(Effect.scoped),
  );

  it.live(
    'takes a socket closing twice as closing once, and text that is no frame as nothing',
    () =>
      Effect.gen(function* () {
        const room = yield* Room.make(options);
        const tick = Effect.map(room.host.world, ({ tick }) => tick);
        const staying = yield* entered(room);
        const going = yield* entered(room);

        yield* going.opened.closed;
        yield* going.opened.closed;
        yield* staying.opened.received('no frame at all');
        yield* Effect.sleep('100 millis');
        const before = yield* tick;
        yield* Effect.sleep('200 millis');

        expect(yield* someone(staying.client)).toEqual([staying.client.entity]);
        expect(yield* tick).toBeGreaterThan(before);
      }).pipe(Effect.scoped),
  );
});

describe("a room's id", () => {
  it('is read from where a Worker is asked for a room, and only from there, and written back the same', () => {
    const lobby = Room.idOf('/rooms/lobby-1');

    expect(Option.map(lobby, Room.pathOf)).toEqual(Option.some('/rooms/lobby-1'));
    expect(
      ['/rooms/', '/rooms/a/b', '/rooms/..', '/elsewhere/lobby', `/rooms/${'x'.repeat(65)}`].map(
        Room.idOf,
      ),
    ).toEqual([Option.none(), Option.none(), Option.none(), Option.none(), Option.none()]);
  });
});
