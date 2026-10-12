import { describe, expect, it } from '@effect/vitest';
import { State } from '@lightocean/core';
import { Effect, Fiber, Option } from 'effect';
import * as Fixtures from '#src/fixtures.ts';
import * as Recording from '#src/Recording.ts';
import * as Reload from '#src/Reload.ts';
import * as Replay from '#src/Replay.ts';
import * as Rewind from '#src/Rewind.ts';

/** A host recorded, replayed beside, and kept for going back, while its game is swapped for a new build. */
const reloaded = Effect.gen(function* () {
  const hosted = yield* Fixtures.host(Fixtures.game, true);
  const recorder = yield* Recording.record(hosted, Fixtures.game);
  const watching = yield* Replay.alongside(hosted, Fixtures.setup()).pipe(Effect.forkChild);
  const rewind = yield* Rewind.make(hosted, Fixtures.setup(), { every: 3, keepSeconds: 10 });
  yield* Fixtures.elapse(100);
  const before = yield* hosted.state;
  yield* hosted.reload(Fixtures.setup(Fixtures.brisk));
  yield* Fixtures.visit(hosted, Fixtures.brisk);
  return { hosted, recorder, watching, rewind, before };
});

describe('a game swapped for a new build', () => {
  it.effect('is recorded in a new segment, each replaying with its own build', () =>
    Effect.gen(function* () {
      const { recorder } = yield* reloaded;

      const segments = yield* recorder.segments;
      const builds = [Fixtures.game, Fixtures.brisk];

      expect(segments).toHaveLength(2);
      expect(segments.at(-1)).toEqual(yield* recorder.recording);
      expect(
        yield* Effect.forEach(segments, (segment, index) =>
          Replay.check(Fixtures.setup(builds[index]), segment),
        ),
      ).toEqual([Option.none(), Option.none()]);
    }),
  );

  it.effect('is replayed beside the host with the new build', () =>
    Effect.gen(function* () {
      const { watching } = yield* reloaded;

      yield* Fixtures.elapse(100);

      expect(watching.pollUnsafe()).toBeUndefined();
      yield* Fiber.interrupt(watching);
    }),
  );

  it.effect('is gone back in from the state it was swapped in at, with the new build', () =>
    Effect.gen(function* () {
      const { rewind, before } = yield* reloaded;

      const { oldest } = yield* rewind.span;

      expect(oldest).toBe(before.tick);
      expect(Option.isSome(yield* rewind.stateAt(before.tick + 2))).toBe(true);
    }),
  );
});

const options = (played = Fixtures.game) => ({
  ...Fixtures.setup(played),
  state: State.empty({ seed: 7 }),
  maySuspend: false,
});

describe('hosting across builds', () => {
  it.effect('makes and serves a host the first time, and hands it each new build after', () =>
    Effect.gen(function* () {
      const kept = {};
      const served: Array<number> = [];

      yield* Reload.host(kept, options(), (host) =>
        Effect.map(host.state, (state) => {
          served.push(state.tick);
        }),
      );
      yield* Fixtures.elapse(100);
      yield* Reload.host(kept, options(Fixtures.brisk), () =>
        Effect.sync(() => {
          served.push(-1);
        }),
      );
      const tick = yield* Option.match(Reload.kept(kept), {
        onNone: () => Effect.succeed(Option.none<number>()),
        onSome: (host) => Effect.map(host.state, ({ tick }) => Option.some(tick)),
      });

      expect(served).toEqual([0]);
      expect(tick).toEqual(Option.some(3));
    }),
  );

  it.effect('says why a build cannot take up the state the host holds', () =>
    Effect.gen(function* () {
      const kept = {};
      yield* Reload.host(kept, options(), () => Effect.void);

      const refused = yield* Reload.host(
        kept,
        { ...options(), game: Fixtures.slow },
        () => Effect.void,
      ).pipe(Effect.flip);

      expect(refused.reason).toContain('steps');
    }),
  );
});
