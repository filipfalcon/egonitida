import type { Host } from '@nitida/core';
import { Effect, type Scope, Stream } from 'effect';
import * as Glance from '#src/glance.ts';

/**
 * Where the first game's time starts: its host watches the telling, and as time starts stepping in it, goes on from the state begun there, at its first tick, in place of the one before. Everything the state held comes with it, every tick it remembers counted from there, so what came before was before tick 0.
 */

/** A step the host took, and the state it took it to. */
type Stepped = Extract<Host.Happening, { readonly _tag: 'Stepped' }>;

/** Begins `host`'s state anew each time its telling comes to the point, until the scope closes. */
export const serve = (host: Host.Host): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    const watching = yield* host.watch;
    yield* watching.happenings.pipe(
      Stream.filter((happening): happening is Stepped => happening._tag === 'Stepped'),
      Stream.filter(({ state }) => Glance.isAboutToBegin(state)),
      Stream.runForEach(({ state }) => host.restore(Glance.begun(state))),
      Effect.forkScoped,
    );
  });
