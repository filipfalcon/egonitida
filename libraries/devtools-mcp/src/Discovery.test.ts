import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from '@effect/vitest';
import { Relay } from '@egonitida/devtools';
import { Effect } from 'effect';
import * as Discovery from '#src/Discovery.ts';

/** A workspace with a package in it, and a way to keep a relay's record in it. */
const workspace = Effect.gen(function* () {
  const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), 'egonitida-workspace-')));
  const inside = join(root, 'examples', 'horde', 'src');
  const records = join(root, ...Relay.RECORDS);
  yield* Effect.promise(() => mkdir(inside, { recursive: true }));
  yield* Effect.promise(() => mkdir(records, { recursive: true }));
  const keep = (name: string, record: unknown) =>
    Effect.promise(() => writeFile(join(records, name), JSON.stringify(record)));
  return { root, inside, keep };
});

describe('finding the relays', () => {
  it.effect('reads the records of the workspace it is started in, from anywhere inside it', () =>
    Effect.gen(function* () {
      const { inside, keep } = yield* workspace;
      const record = { url: 'ws://127.0.0.1:4000/', token: 'secret', pid: process.pid };
      yield* keep('a.json', record);

      expect(yield* Discovery.relays(inside)).toEqual([record]);
    }),
  );

  it.effect('leaves out the record of a server that is gone, and what is no record', () =>
    Effect.gen(function* () {
      const { root, keep } = yield* workspace;
      yield* keep('gone.json', { url: 'ws://127.0.0.1:4001/', token: 't', pid: 2 ** 22 + 7 });
      yield* keep('broken.json', { url: 3 });

      expect(yield* Discovery.relays(root)).toEqual([]);
    }),
  );

  it.effect('finds none outside any workspace that keeps records', () =>
    Effect.gen(function* () {
      const elsewhere = yield* Effect.promise(() => mkdtemp(join(tmpdir(), 'egonitida-none-')));

      expect(yield* Discovery.relays(elsewhere)).toEqual([]);
    }),
  );
});
