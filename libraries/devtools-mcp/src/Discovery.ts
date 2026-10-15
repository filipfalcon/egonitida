import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Relay } from '@egonitida/devtools';
import { Effect, Option, Schema } from 'effect';

/**
 * Where the relays of the development servers running in a workspace are: the records under the nearest `node_modules/.egonitida/relays` from where the tool was started, up to the root, oldest first. A record is left out if it is no record, or its server is gone, as when a server was killed before it could take its record away.
 */

/** The nearest directory of records at or above `from`. */
const recordsFrom = (from: string): Effect.Effect<Option.Option<string>> =>
  Effect.gen(function* () {
    const records = join(from, ...Relay.RECORDS);
    const found = yield* Effect.promise(() =>
      stat(records).then(
        (kept) => kept.isDirectory(),
        () => false,
      ),
    );
    if (found) {
      return Option.some(records);
    }
    const above = dirname(from);
    return above === from ? Option.none() : yield* recordsFrom(above);
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

const decode = Schema.decodeUnknownOption(Schema.fromJsonString(Relay.Record));

/** The relays running in the workspace `from` is in, oldest first. */
export const relays = (from: string): Effect.Effect<ReadonlyArray<Relay.Record>> =>
  Effect.gen(function* () {
    const records = yield* recordsFrom(from);
    if (Option.isNone(records)) {
      return [];
    }
    const names = yield* Effect.promise(() => readdir(records.value));
    const read = yield* Effect.forEach(
      names.filter((name) => name.endsWith('.json')),
      (name) =>
        Effect.promise(async () => {
          const path = join(records.value, name);
          const [text, kept] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
          return { record: decode(text), at: kept.mtimeMs };
        }),
    );
    return read
      .toSorted((a, b) => a.at - b.at)
      .flatMap(({ record }) => Option.toArray(record))
      .filter(({ pid }) => running(pid));
  });
