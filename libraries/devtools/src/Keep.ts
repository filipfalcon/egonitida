import { Game, type Host, type World } from '@lightocean/core';
import { Duration, Effect, Option, Schema, type Scope, Stream } from 'effect';

/**
 * A hosted world kept across reloads of the page, in development: the host's world, as its game encodes it, kept every so often under a key, such as the id a tab gives its host, and read back by the game when the page comes again, so a change to any code, the page's as much as the game's, goes on from the world it was at. A world the game cannot read is not taken up, and the game starts afresh, saying why.
 *
 * What was played after the world was last kept, up to a second, is lost.
 */

/** Where kept worlds are: by key, each as its game encodes it. */
export interface Store {
  readonly get: (key: string) => Effect.Effect<Option.Option<unknown>>;
  readonly set: (key: string, value: unknown) => Effect.Effect<void>;
}

/** A store in memory, for tests. */
export const memory = (): Store => {
  const kept = new Map<string, unknown>();
  return {
    get: (key) => Effect.sync(() => (kept.has(key) ? Option.some(kept.get(key)) : Option.none())),
    set: (key, value) =>
      Effect.sync(() => {
        kept.set(key, value);
      }),
  };
};

const DATABASE = 'lightocean-devtools';
const WORLDS = 'worlds';

/** Opens the database of kept worlds, made the first time. */
const open = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const opening = indexedDB.open(DATABASE, 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore(WORLDS);
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
  });

/** Does `work` in a transaction on the kept worlds, and comes to what it read. */
const transact = <A>(mode: IDBTransactionMode, work: (worlds: IDBObjectStore) => IDBRequest<A>) =>
  Effect.promise(async () => {
    const database = await open();
    try {
      return await new Promise<A>((resolve, reject) => {
        const request = work(database.transaction(WORLDS, mode).objectStore(WORLDS));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  });

/** The store of this browser's IndexedDB, wherever there is one, as in a page's worker. */
export const indexedDb: Option.Option<Store> =
  typeof indexedDB === 'undefined'
    ? Option.none()
    : Option.some({
        get: (key) =>
          Effect.map(
            transact<unknown>('readonly', (worlds) => worlds.get(key)),
            Option.fromNullishOr,
          ),
        set: (key, value) =>
          Effect.asVoid(transact('readwrite', (worlds) => worlds.put(value, key))),
      });

/** The world kept under `key`, as `game` reads it, if one is kept and the game can read it. */
export const load = (
  store: Store,
  game: Game.Game,
  key: string,
): Effect.Effect<Option.Option<World.World>> =>
  Effect.flatMap(store.get(key), (kept) =>
    Option.match(kept, {
      onNone: () => Effect.succeed(Option.none<World.World>()),
      onSome: (encoded) =>
        Schema.decodeUnknownEffect(Game.schema(game))(encoded).pipe(
          Effect.asSome,
          Effect.catch((issue) =>
            Effect.as(
              Effect.logWarning(
                `The world kept from before cannot be taken up, so the game starts afresh: ${issue.message}`,
              ),
              Option.none<World.World>(),
            ),
          ),
        ),
    }),
  );

/** Keeps the world `host` is at under `key`, every `everyMillis`, as the build it plays encodes it, from `game` on, until the scope closes. */
export const serve = (
  store: Store,
  host: Host.Host,
  game: Game.Game,
  options: { readonly key: string; readonly everyMillis: number },
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    const state = { game };
    const watching = yield* host.watch;
    yield* watching.happenings.pipe(
      Stream.runForEach((happening) =>
        Effect.sync(() => {
          if (happening._tag === 'Reloaded') {
            state.game = happening.game;
          }
        }),
      ),
      Effect.forkScoped,
    );
    yield* Effect.gen(function* () {
      yield* Effect.sleep(Duration.millis(options.everyMillis));
      const world = yield* host.world;
      // A world its own game cannot encode is a bug in the engine; keeping goes on with the next.
      yield* Schema.encodeEffect(Game.schema(state.game))(world).pipe(
        Effect.flatMap((encoded) => store.set(options.key, encoded)),
        Effect.ignore,
      );
    }).pipe(Effect.forever, Effect.forkScoped);
  });
