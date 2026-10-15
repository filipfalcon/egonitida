import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';
import { Relay } from '@egonitida/devtools';
import { Data, Effect, Option, Schema, type Scope } from 'effect';
import { type RawData, type WebSocket, WebSocketServer } from 'ws';

/**
 * A relay reachable by the tools on this machine that know its token: a WebSocket server on a loopback port of its own, so nothing else the development server serves sees its traffic, and a record of where it listens and its token, which only its user may read, kept while it listens. Each relay keeps a record of its own, so several development servers can run at once.
 */

export interface Listening extends Relay.Record {
  /** Where its record is kept. */
  readonly record: string;
}

export class ListenFailed extends Data.TaggedError('ListenFailed')<{ readonly reason: string }> {}

/** Whether `request` gives `token`, compared in constant time. */
const gives = (request: IncomingMessage, token: string) => {
  const given = new URL(request.url ?? '/', 'ws://relay').searchParams.get('token') ?? '';
  const expected = Buffer.from(token);
  const offered = Buffer.from(given);
  return offered.length === expected.length && timingSafeEqual(offered, expected);
};

/** What arrived on a socket, as text. */
const textOf = (data: RawData): string =>
  Array.isArray(data)
    ? Buffer.concat(data).toString('utf8')
    : data instanceof ArrayBuffer
      ? Buffer.from(data).toString('utf8')
      : data.toString('utf8');

const fromJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

/** The relay as a tool reaches it on `socket`: what the relay sends goes out as JSON. */
const toolOn = (socket: WebSocket): Relay.Peer<Relay.FromRelay> => ({
  send: (message) =>
    Schema.encodeEffect(Relay.FromRelay)(message).pipe(
      // A message the relay made itself always encodes; one that does not is a bug in it.
      Effect.orDie,
      Effect.flatMap((encoded) => Effect.sync(() => socket.send(JSON.stringify(encoded)))),
    ),
});

/** Whether the process `pid` still runs. */
const running = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // A process of another user's runs, though this one may not signal it.
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
};

const recordFromJson = Schema.decodeUnknownOption(Schema.fromJsonString(Relay.Record));

/** Takes away the records in `directory` of servers that are gone, such as one stopped before it could take its own away. */
const clearGone = (directory: string) =>
  Effect.promise(async () => {
    const names = await readdir(directory).catch(() => []);
    await Promise.all(
      names
        .filter((name) => name.endsWith('.json'))
        .map(async (name) => {
          const path = join(directory, name);
          const record = recordFromJson(await readFile(path, 'utf8').catch(() => ''));
          if (Option.isSome(record) && !running(record.value.pid)) {
            await rm(path, { force: true });
          }
        }),
    );
  });

/** Opens a server on a loopback port the system chooses, once it listens. */
const open = (token: string) =>
  Effect.acquireRelease(
    Effect.callback<WebSocketServer, ListenFailed>((resume) => {
      const server = new WebSocketServer({
        host: '127.0.0.1',
        port: 0,
        verifyClient: ({ req }, done) => (gives(req, token) ? done(true) : done(false, 401)),
      });
      server.once('listening', () => resume(Effect.succeed(server)));
      server.once('error', (error) =>
        resume(Effect.fail(new ListenFailed({ reason: error.message }))),
      );
    }),
    (server) =>
      Effect.callback<void>((resume) => {
        for (const client of server.clients) {
          client.terminate();
        }
        server.close(() => resume(Effect.void));
      }),
  );

/** Listens for tools to `relay` until the scope closes, keeping its record in `directory` meanwhile. */
export const listen = (
  relay: Relay.Relay,
  options: { readonly directory: string },
): Effect.Effect<Listening, ListenFailed, Scope.Scope> =>
  Effect.gen(function* () {
    const token = randomBytes(32).toString('hex');
    const server = yield* open(token);
    const address = server.address();
    if (typeof address !== 'object' || address === null) {
      return yield* new ListenFailed({ reason: 'the relay has no port' });
    }
    const url = `ws://127.0.0.1:${address.port}/`;

    // The server's events come from outside any Effect; what they do runs with the services the relay listens with.
    const run = Effect.runForkWith(yield* Effect.context<never>());
    server.on('connection', (socket) => {
      const tool = toolOn(socket);
      socket.on('message', (data) => {
        Option.map(fromJson(textOf(data)), (message) => run(relay.fromTool(tool, message)));
      });
      socket.on('close', () => run(relay.toolGone(tool)));
    });

    yield* clearGone(options.directory);
    const record = join(options.directory, `${process.pid}-${address.port}.json`);
    const kept: Relay.Record = { url, token, pid: process.pid };
    yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: async () => {
          await mkdir(options.directory, { recursive: true, mode: 0o700 });
          await writeFile(record, JSON.stringify(kept), { mode: 0o600 });
        },
        catch: (error) => new ListenFailed({ reason: `cannot keep its record: ${String(error)}` }),
      }),
      () => Effect.promise(() => rm(record, { force: true })),
    );
    return { ...kept, record };
  });
