import type { Host } from '@egonitida/core';
import { Effect, type Scope } from 'effect';
import * as Inspect from '#src/Inspect.ts';
import type * as Replay from '#src/Replay.ts';
import * as Rewind from '#src/Rewind.ts';

/**
 * A debugger beside a host, as an editor plays a document with one: the last stretch of time kept, for a client to go back in by its controls, and the questions its clients ask of it, such as what happened at each step, answered by an inspector. It needs no development server, so it serves wherever the host runs.
 */

/** Keeps the past of `host`, which plays `setup`, and answers its clients' questions of it, until the scope closes: thirty seconds kept, a keyframe every half second, unless told. */
export const serve = (
  host: Host.Host,
  setup: Replay.Setup,
  options: Rewind.Options = { every: Math.round(setup.game.stepRate / 2), keepSeconds: 30 },
): Effect.Effect<
  { readonly rewind: Rewind.Rewind; readonly inspector: Inspect.Inspector },
  never,
  Scope.Scope
> =>
  Effect.gen(function* () {
    const rewind = yield* Rewind.make(host, setup, options);
    yield* Rewind.serve(host, rewind);
    const inspector = Inspect.make(host, rewind);
    yield* Inspect.answering(host, inspector);
    return { rewind, inspector };
  });
