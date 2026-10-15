import { mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from '@effect/vitest';
import { Relay } from '@egonitida/devtools';
import { Effect, Exit, Scope } from 'effect';
import WebSocket from 'ws';
import * as Listener from '#src/Listener.ts';

/** A directory of its own, for a test's records. */
const directory = Effect.promise(() => mkdtemp(join(tmpdir(), 'egonitida-listener-')));

/** What a tool connecting to `url` hears first after sending `message`, or how its connection failed. */
const ask = (url: string, message: unknown) =>
  Effect.callback<string>((resume) => {
    const socket = new WebSocket(url);
    socket.on('open', () => socket.send(JSON.stringify(message)));
    socket.on('message', (data) => {
      resume(
        Effect.succeed(
          Array.isArray(data) || data instanceof ArrayBuffer ? 'not text' : data.toString('utf8'),
        ),
      );
      socket.close();
    });
    socket.on('unexpected-response', (_, response) => {
      resume(Effect.succeed(`refused with ${response.statusCode}`));
    });
  });

describe('a relay listening for tools', () => {
  it.live('says where it listens in a record only its user may read, gone once it stops', () =>
    Effect.gen(function* () {
      const kept = yield* directory;
      const scope = yield* Scope.make();
      const listening = yield* Listener.listen(yield* Relay.make, { directory: kept }).pipe(
        Scope.provide(scope),
      );

      const record = JSON.parse(yield* Effect.promise(() => readFile(listening.record, 'utf8')));
      const mode = (yield* Effect.promise(() => stat(listening.record))).mode & 0o777;
      yield* Scope.close(scope, Exit.void);
      const left = yield* Effect.promise(() => readdir(kept));

      expect(record).toEqual({ url: listening.url, token: listening.token, pid: process.pid });
      expect(listening.url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/$/);
      expect(mode).toBe(0o600);
      expect(left).toEqual([]);
    }),
  );

  it.live('relays a tool that gives its token', () =>
    Effect.gen(function* () {
      const listening = yield* Listener.listen(yield* Relay.make, { directory: yield* directory });

      const heard = yield* ask(`${listening.url}?token=${listening.token}`, {
        _tag: 'Hosts',
        id: 1,
      });

      expect(JSON.parse(heard)).toEqual({ _tag: 'Hosts', id: 1, hosts: [] });
    }),
  );

  it.live('refuses a tool without its token', () =>
    Effect.gen(function* () {
      const listening = yield* Listener.listen(yield* Relay.make, { directory: yield* directory });

      expect(yield* ask(listening.url, { _tag: 'Hosts', id: 1 })).toBe('refused with 401');
      expect(yield* ask(`${listening.url}?token=wrong`, { _tag: 'Hosts', id: 1 })).toBe(
        'refused with 401',
      );
    }),
  );

  it.live('takes away the records of servers that are gone, as it starts', () =>
    Effect.gen(function* () {
      const kept = yield* directory;
      const record = (pid: number) => JSON.stringify({ url: 'ws://127.0.0.1:1/', token: 't', pid });
      yield* Effect.promise(() => writeFile(join(kept, 'gone.json'), record(2 ** 22 + 7)));
      yield* Effect.promise(() => writeFile(join(kept, 'running.json'), record(process.pid)));

      const listening = yield* Listener.listen(yield* Relay.make, { directory: kept });
      const left = yield* Effect.promise(() => readdir(kept));

      expect(left.toSorted()).toEqual(
        [listening.record.slice(kept.length + 1), 'running.json'].toSorted(),
      );
    }),
  );
});
