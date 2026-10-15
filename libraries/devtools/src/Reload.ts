import { Host } from '@egonitida/core';
import { Effect, Option, type Scope } from 'effect';

/**
 * A host kept across new builds of its game, in development. A module that hosts a game is run again when the game's code changes; the host it made is kept by what outlives each run of the module, its hot data, and handed the new build, so the game plays on from the state it was at, with its clients, its recording, and its rewind.
 */

// What each module's hot data keeps: a host it made. Weakly, so a module that goes for good takes its host's record with it.
const hosts = new WeakMap<object, Host.Host<unknown>>();

/**
 * Hosts a game across builds: the first time, makes a host from `options` and runs `serve` with it; every time after, with the same `kept`, hands the host it made the build `options` holds instead, keeping its state, or fails saying why the build cannot take the state up. With nothing `kept`, as outside development, it only makes and serves.
 */
export const host = <Services = never, E = never, R = never>(
  kept: object | undefined,
  options: Host.Options<Services>,
  serve: (host: Host.Host<Services>) => Effect.Effect<void, E, R>,
): Effect.Effect<void, E | Host.Unreadable, R | Services | Scope.Scope> =>
  Effect.gen(function* () {
    const known = kept === undefined ? undefined : hosts.get(kept);
    if (known !== undefined) {
      return yield* known.reload(options);
    }
    const made = yield* Host.make(options);
    if (kept !== undefined) {
      hosts.set(kept, made);
    }
    yield* serve(made);
  });

/** The host kept by `kept`, if one was made with it. */
export const kept = (kept: object): Option.Option<Host.Host<unknown>> =>
  Option.fromNullishOr(hosts.get(kept));
