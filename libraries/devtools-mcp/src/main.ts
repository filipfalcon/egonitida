#!/usr/bin/env node
import { NodeRuntime, NodeStdio } from '@effect/platform-node';
import { Duration, Effect, Option, Schedule, Schema, Stdio, Stream } from 'effect';
import * as Proxy from '#src/Proxy.ts';
import * as Server from '#src/Server.ts';

// The MCP server an agent starts: a proxy over stdio to the newest development server of the workspace it was started in, or of EGONITIDA_WORKSPACE if set, its own tools answering while none runs.
const from = process.env['EGONITIDA_WORKSPACE'] ?? process.cwd();

/** How often the proxy looks for a development server started anew, so its client hears of it unasked. */
const LOOKING = Duration.seconds(2);

const fromJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

const main = Effect.gen(function* () {
  const stdio = yield* Stdio.Stdio;
  const own = Server.web(from);
  yield* Effect.addFinalizer(() => Effect.promise(own.dispose));
  const proxy = yield* Proxy.make({
    from,
    own: own.handler,
    say: (message) => Effect.sync(() => void process.stdout.write(`${JSON.stringify(message)}\n`)),
  });
  yield* Effect.forkScoped(Effect.repeat(proxy.look, Schedule.spaced(LOOKING)));
  // Each message on a line of its own, each taken on its own, so a slow one keeps no other waiting.
  yield* stdio.stdin.pipe(
    Stream.decodeText,
    Stream.splitLines,
    Stream.runForEach((line) =>
      Option.match(fromJson(line), {
        onNone: () => Effect.void,
        onSome: (message) => Effect.asVoid(Effect.forkScoped(proxy.receive(message))),
      }),
    ),
  );
});

main.pipe(Effect.scoped, Effect.provide(NodeStdio.layer), NodeRuntime.runMain);
