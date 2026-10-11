import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Component, Domain, Game, Host, System, World } from '@lightocean/core';
import { Bridge, Inspect, Relay, Rewind } from '@lightocean/devtools';
import { Listener } from '@lightocean/vite-plugin';
import { Effect, Queue, Schema, Stream } from 'effect';

/**
 * What the MCP server's tests share: a game that counts its steps, and a relay with hosts of it, as a development server would have them.
 */

export const Count = Component.make('Count', Schema.Struct({ value: Schema.Int }), {
  owner: 'simulation',
  network: 'server',
});

/** A game that counts its steps. */
export const counting = Game.make({
  stepRate: 30,
  domains: [
    Domain.make({
      name: 'Counting',
      requires: [],
      components: [Count],
      actions: [],
      events: [],
      systems: [
        System.make({
          name: 'count',
          reads: [],
          writes: [Count],
          emits: [],
          run: (context) => {
            for (const [entity, { value }] of context.query(Count)) {
              context.set(entity, Count, { value: value + 1 });
            }
          },
        }),
      ],
      rules: [],
    }),
  ],
});

/** A relay listening for tools, keeping its record in `directory`, a directory of its own unless given, and hosts of the counting game called `names` said hello to it, each over a channel in memory, their time held. */
export const served = (names: ReadonlyArray<string>, directory?: string) =>
  Effect.gen(function* () {
    const relay = yield* Relay.make;
    const kept =
      directory ?? (yield* Effect.promise(() => mkdtemp(join(tmpdir(), 'lightocean-relay-'))));
    const listening = yield* Listener.listen(relay, { directory: kept });
    for (const name of names) {
      const setup = {
        game: counting,
        join: (world: World.World) => World.spawn(world, []),
        leave: World.despawn,
      };
      const host = yield* Host.make({
        ...setup,
        world: World.spawn(World.empty({ seed: 1 }), [Count.of({ value: 0 })])[0],
        mayHold: true,
      });
      yield* host.hold;
      const rewind = yield* Rewind.make(host, setup, { every: 5, keepSeconds: 10 });
      const toHost = yield* Queue.unbounded<unknown>();
      const peer: Relay.Peer<Bridge.ToHost> = {
        send: (message) => Queue.offer(toHost, Schema.encodeSync(Bridge.ToHost)(message)),
      };
      const channel: Bridge.Channel = {
        send: (message) => relay.fromHost(peer, Schema.encodeSync(Bridge.FromHost)(message)),
        received: Stream.fromQueue(toHost),
      };
      yield* Bridge.serve(channel, Inspect.make(host, rewind), { name });
    }
    return listening;
  });
