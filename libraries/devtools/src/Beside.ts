import type { Host } from '@lightocean/core';
import { Effect, Option, type Scope } from 'effect';
import * as Bridge from '#src/Bridge.ts';
import * as Inspect from '#src/Inspect.ts';
import * as Keep from '#src/Keep.ts';
import * as Reload from '#src/Reload.ts';
import * as Replay from '#src/Replay.ts';
import * as Rewind from '#src/Rewind.ts';

/**
 * Everything the devtools run beside a host in development, in one: the game replayed beside it, with where it first comes apart reported; the last stretch of time kept, for a page to go back in; and a bridge to the development server's relay, so an agent can ask after the game and play it.
 */

/** Runs the devtools beside `host`, which plays `setup`, until the scope closes: the host called `name`, by `id` if a page chose one, over `channel`, the development server's unless given. */
export const serve = (
  host: Host.Host,
  setup: Replay.Setup,
  options: {
    readonly name: string;
    readonly id?: string | undefined;
    readonly channel?: Bridge.Channel | undefined;
    /** How far back time is kept, and how many steps apart its keyframes are; thirty seconds, a keyframe every half second, unless given. */
    readonly rewind?: Rewind.Options | undefined;
  },
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    yield* Replay.alongside(host, setup).pipe(
      Effect.flatMap((divergence) =>
        Effect.logError(`${options.name} does not replay as it was played`, divergence),
      ),
      Effect.catch((unreadable) =>
        Effect.logError(`${options.name} cannot be replayed`, unreadable),
      ),
      Effect.forkScoped,
    );
    const rewind = yield* Rewind.make(
      host,
      setup,
      options.rewind ?? { every: Math.round(setup.game.stepRate / 2), keepSeconds: 30 },
    );
    yield* Rewind.serve(host, rewind);
    yield* Option.match(
      Option.orElse(Option.fromNullishOr(options.channel), () => Bridge.vite),
      {
        onNone: () => Effect.void,
        onSome: (channel) =>
          Bridge.serve(channel, Inspect.make(host, rewind), {
            name: options.name,
            ...(options.id === undefined ? {} : { id: options.id }),
          }),
      },
    );
  });

/**
 * Hosts a game in development with everything the devtools give: from the world kept for the tab the host is known by, if the game can read it; kept on every second, so reloading the page goes on from it; handed each new build of the game as its code changes, by what outlives each run of the module that hosts it (`kept`, its hot data); and with the devtools beside it. `serving` serves the host, the first time only.
 */
export const host = <Services = never, E = never, R = never>(
  options: Host.Options<Services>,
  devtools: {
    readonly name: string;
    /** The id the host is known by, which a tab keeps across reloads of its page. */
    readonly id: string;
    /** What outlives each run of the module that hosts the game, such as its hot data. */
    readonly kept: object | undefined;
    /** Where worlds are kept; the browser's IndexedDB unless given. */
    readonly store?: Option.Option<Keep.Store> | undefined;
  },
  serving: (host: Host.Host<Services>) => Effect.Effect<void, E, R>,
): Effect.Effect<void, E | Host.Unreadable, R | Services | Scope.Scope> =>
  Effect.gen(function* () {
    const store = devtools.store ?? Keep.indexedDb;
    const kept = yield* Option.match(store, {
      onNone: () => Effect.succeedNone,
      onSome: (found) => Keep.load(found, options.game, devtools.id),
    });
    yield* Reload.host(
      devtools.kept,
      { ...options, world: Option.getOrElse(kept, () => options.world) },
      (hosted) =>
        Effect.gen(function* () {
          yield* serve(hosted, options, { name: devtools.name, id: devtools.id });
          yield* Option.match(store, {
            onNone: () => Effect.void,
            onSome: (found) =>
              Keep.serve(found, hosted, options.game, { key: devtools.id, everyMillis: 1000 }),
          });
          yield* serving(hosted);
        }),
    );
  });
