import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from '@effect/vitest';
import { Relay } from '@egonitida/devtools';
import { Effect, Exit, Scope } from 'effect';
import { served } from '#src/fixtures.ts';
import * as Proxy from '#src/Proxy.ts';
import * as Server from '#src/Server.ts';

/** A workspace of its own, where its relays keep their records, and where an agent starts the proxy inside it. */
const workspace = Effect.gen(function* () {
  const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), 'egonitida-proxy-')));
  const inside = join(root, 'examples', 'counting');
  yield* Effect.promise(() => mkdir(inside, { recursive: true }));
  return { records: join(root, ...Relay.RECORDS), inside };
});

/** The proxy started inside `inside`, with tools of its own that find no game, and what it has said to its client. */
const started = (inside: string) =>
  Effect.gen(function* () {
    const nowhere = yield* Effect.promise(() => mkdtemp(join(tmpdir(), 'egonitida-nowhere-')));
    const own = Server.web(nowhere);
    yield* Effect.addFinalizer(() => Effect.promise(own.dispose));
    const said: Array<unknown> = [];
    const proxy = yield* Proxy.make({
      from: inside,
      own: own.handler,
      say: (message) => Effect.sync(() => void said.push(message)),
    });
    yield* proxy.receive({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '0' },
      },
    });
    yield* proxy.receive({ jsonrpc: '2.0', method: 'notifications/initialized' });
    return { proxy, said };
  });

/** What the client heard in answer to the request with `id`. */
const answerTo = (said: ReadonlyArray<unknown>, id: number): unknown =>
  said.find(
    (message) =>
      typeof message === 'object' && message !== null && Reflect.get(message, 'id') === id,
  );

/** What the tool `name` answered, called through the proxy with the request id `id`. */
const call = (
  { proxy, said }: { readonly proxy: Proxy.Proxy; readonly said: ReadonlyArray<unknown> },
  id: number,
  name: string,
) =>
  Effect.map(
    proxy.receive({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name, arguments: {} },
    }),
    () => answerTo(said, id),
  );

describe('the proxy an agent starts', () => {
  it.live(
    'sends what it is asked to the development server of its workspace, and answers as it answered',
    () =>
      Effect.gen(function* () {
        const { records, inside } = yield* workspace;
        yield* served(['counting'], records);
        const client = yield* started(inside);

        const greeting = answerTo(client.said, 0);
        const hosts = yield* call(client, 1, 'egonitida_hosts');

        expect(JSON.stringify(greeting)).toContain('egonitida-devtools');
        expect(hosts).toMatchObject({
          id: 1,
          result: {
            content: [
              { type: 'text', text: JSON.stringify([{ host: 'counting', name: 'counting' }]) },
            ],
          },
        });
      }).pipe(Effect.scoped),
  );

  it.live(
    'answers with tools of its own while no development server runs, saying why they cannot',
    () =>
      Effect.gen(function* () {
        const { inside } = yield* workspace;
        const client = yield* started(inside);

        const shot = yield* call(client, 1, 'egonitida_screenshot');

        expect(shot).toMatchObject({
          id: 1,
          result: {
            isError: true,
            content: [
              {
                text: 'no development server with the EgoNitida devtools plugin is running in this workspace',
              },
            ],
          },
        });
      }).pipe(Effect.scoped),
  );

  it.live(
    'reaches a development server started anew, and tells its client the tools may have changed',
    () =>
      Effect.gen(function* () {
        const { records, inside } = yield* workspace;
        const first = yield* Scope.make();
        yield* served(['before'], records).pipe(Scope.provide(first));
        const client = yield* started(inside);
        yield* call(client, 1, 'egonitida_hosts');

        yield* Scope.close(first, Exit.void);
        yield* served(['after'], records);
        yield* client.proxy.look;
        const hosts = yield* call(client, 2, 'egonitida_hosts');

        expect(hosts).toMatchObject({
          result: { content: [{ text: JSON.stringify([{ host: 'after', name: 'after' }]) }] },
        });
        expect(client.said).toContainEqual({
          jsonrpc: '2.0',
          method: 'notifications/tools/list_changed',
        });
      }).pipe(Effect.scoped),
  );
});
