import { Game, type Host, State } from '@lightocean/core';
import { Duration, Effect, Option, Schema, type Scope, Stream } from 'effect';

/**
 * A hosted game's state kept across reloads of the page, in development: the host's state, as its game encodes it, kept every so often under a key, such as the id a tab gives its host, and read back by the game when the page comes again, so a change to any code, the page's as much as the game's, goes on from the state it was at. A state the game cannot read is not taken up, and the game starts afresh, saying why.
 *
 * The players that joined through a client are kept with it, so a page that comes again can be given its own player back. What was played after the state was last kept, up to a second, is lost.
 */

/** Where kept states are: by key, each as its game encodes it. */
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
const VERSION = 2;
const STATES = 'states';

/** Opens the database of kept states, made the first time and made over when it is of an earlier version: any store but the kept states is dropped. */
const open = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const opening = indexedDB.open(DATABASE, VERSION);
    opening.onupgradeneeded = () => {
      const database = opening.result;
      // Its list of stores changes as one is dropped, so the stores to drop are listed first.
      const dropped = Array.from(database.objectStoreNames).filter((name) => name !== STATES);
      for (const name of dropped) {
        database.deleteObjectStore(name);
      }
      if (!database.objectStoreNames.contains(STATES)) {
        database.createObjectStore(STATES);
      }
    };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
  });

/** Does `work` in a transaction on the kept states, and comes to what it read. */
const transact = <A>(mode: IDBTransactionMode, work: (states: IDBObjectStore) => IDBRequest<A>) =>
  Effect.promise(async () => {
    const database = await open();
    try {
      return await new Promise<A>((resolve, reject) => {
        const request = work(database.transaction(STATES, mode).objectStore(STATES));
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
            transact<unknown>('readonly', (states) => states.get(key)),
            Option.fromNullishOr,
          ),
        set: (key, value) =>
          Effect.asVoid(transact('readwrite', (states) => states.put(value, key))),
      });

/** A state as it is kept: as its game encodes it, with the players that joined through a client. */
const Kept = Schema.Struct({ state: Schema.Unknown, players: Schema.Array(Schema.Int) });

/** A kept state read back: the state, and the players of it that joined through a client and are still in it. */
export interface Taken {
  readonly state: State.State;
  readonly players: ReadonlyArray<State.Entity>;
}

/** The state kept under `key`, as `game` reads it, with its players, if one is kept and the game can read it. */
export const load = (
  store: Store,
  game: Game.Game,
  key: string,
): Effect.Effect<Option.Option<Taken>> =>
  Effect.flatMap(store.get(key), (kept) =>
    Option.match(kept, {
      onNone: () => Effect.succeedNone,
      onSome: (value) =>
        Effect.gen(function* () {
          const { state: encoded, players } = yield* Schema.decodeUnknownEffect(Kept)(value);
          const state = yield* Schema.decodeUnknownEffect(Game.schema(game))(encoded);
          const present = new Set(State.entities(state));
          return { state, players: players.filter((player) => present.has(player)) };
        }).pipe(
          Effect.asSome,
          Effect.catch((issue) =>
            Effect.as(
              Effect.logWarning(
                `The state kept from before cannot be taken up, so the game starts afresh: ${issue.message}`,
              ),
              Option.none<Taken>(),
            ),
          ),
        ),
    }),
  );

/** Keeps the state `host` is at under `key`, every `everyMillis`, as the build it plays encodes it, from `game` on, with the players that joined through a client since, until the scope closes. */
export const serve = (
  store: Store,
  host: Host.Host,
  game: Game.Game,
  options: {
    readonly key: string;
    readonly everyMillis: number;
    /** Players that joined before keeping began, such as those taken up from a kept state. */
    readonly players?: ReadonlyArray<State.Entity>;
  },
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    const saving = { game, players: new Set<State.Entity>(options.players ?? []) };
    const watching = yield* host.watch;
    yield* watching.happenings.pipe(
      Stream.runForEach((happening) =>
        Effect.sync(() => {
          if (happening._tag === 'Reloaded') {
            saving.game = happening.game;
          } else if (happening._tag === 'Joined' && happening.client) {
            saving.players.add(happening.entity);
          } else if (happening._tag === 'Left') {
            saving.players.delete(happening.entity);
          }
        }),
      ),
      Effect.forkScoped,
    );
    yield* Effect.gen(function* () {
      yield* Effect.sleep(Duration.millis(options.everyMillis));
      const state = yield* host.state;
      // A state its own game cannot encode is a bug in the engine; keeping goes on with the next.
      yield* Schema.encodeEffect(Game.schema(saving.game))(state).pipe(
        Effect.flatMap((encoded) =>
          store.set(options.key, { state: encoded, players: [...saving.players] }),
        ),
        Effect.ignore,
      );
    }).pipe(Effect.forever, Effect.forkScoped);
  });
