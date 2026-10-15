import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Component, Domain, Game, Host, System, State } from '@egonitida/core';
import { Bridge, Inspect, Page, Relay, Rewind } from '@egonitida/devtools';
import { Listener } from '@egonitida/vite-plugin';
import { Effect, Option, Queue, Schema, Stream } from 'effect';
import * as Server from '#src/Server.ts';

/**
 * What the MCP server's tests share: a game that counts its steps, and a relay with hosts of it, as a development server would have them.
 */

/** The smallest PNG there is, one transparent pixel, as base64. */
export const PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

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

/** A relay listening for tools, keeping its record in `directory`, a directory of its own unless given, serving the MCP server beside it for the workspace the directory is in, as a development server does, and hosts of the counting game called `names` said hello to it, each over a channel in memory, their time suspended, and each drawn by a page whose every shot is one pixel, and which takes every press. */
export const served = (names: ReadonlyArray<string>, directory?: string) =>
  Effect.gen(function* () {
    const relay = yield* Relay.make;
    const kept =
      directory ?? (yield* Effect.promise(() => mkdtemp(join(tmpdir(), 'egonitida-relay-'))));
    // The records lie three directories down from the workspace's root.
    const mcp = Server.web(dirname(dirname(dirname(kept))));
    yield* Effect.addFinalizer(() => Effect.promise(mcp.dispose));
    const listening = yield* Listener.listen(relay, {
      directory: kept,
      mcp: { path: Server.PATH, respond: mcp.handler },
    });
    for (const name of names) {
      const setup = {
        game: counting,
        join: (state: State.State) => State.spawn(state, [Count.of({ value: 0 })]),
        leave: State.despawn,
      };
      const host = yield* Host.make({
        ...setup,
        state: State.spawn(State.empty({ seed: 1 }), [Count.of({ value: 0 })])[0],
        maySuspend: true,
      });
      yield* host.suspend;
      const rewind = yield* Rewind.make(host, setup, { every: 5, keepSeconds: 10 });
      const toHost = yield* Queue.unbounded<unknown>();
      const peer: Relay.Peer<Bridge.ToHost> = {
        send: (message) => Queue.offer(toHost, Schema.encodeSync(Bridge.ToHost)(message)),
      };
      const channel: Bridge.Channel = {
        send: (message) => relay.fromHost(peer, Schema.encodeSync(Bridge.FromHost)(message)),
        received: Stream.fromQueue(toHost),
      };
      yield* Bridge.serve(channel, Inspect.make(host, rewind), { name, id: name });
      // A page drawing the host, whose every shot is the smallest PNG, as wide as asked.
      const toPage = yield* Queue.unbounded<unknown>();
      const pagePeer: Relay.Peer<Bridge.ToHost> = {
        send: (message) => Queue.offer(toPage, Schema.encodeSync(Bridge.ToHost)(message)),
      };
      yield* Page.serve(
        {
          send: (message) => relay.fromHost(pagePeer, Schema.encodeSync(Bridge.FromHost)(message)),
          received: Stream.fromQueue(toPage),
        },
        {
          host: name,
          capture: (width) =>
            Effect.succeed({ png: PIXEL, width: Option.getOrElse(width, () => 1), height: 1 }),
          press: () => Effect.void,
        },
      );
    }
    return listening;
  });
