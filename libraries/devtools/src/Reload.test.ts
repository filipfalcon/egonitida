import { describe, expect, it } from '@effect/vitest';
import { Host, State } from '@lightocean/core';
import { Effect, Fiber, Option } from 'effect';
import * as Fixtures from '#src/fixtures.ts';
import * as Recording from '#src/Recording.ts';
import * as Reload from '#src/Reload.ts';
import * as Replay from '#src/Replay.ts';
import * as Rewind from '#src/Rewind.ts';
import * as Version from '#src/Version.ts';

/** A host of build `one` recorded, replayed beside, and kept for going back, while its game is swapped for build `two`. */
const reloaded = Effect.gen(function* () {
  const hosted = yield* Host.make({
    ...Fixtures.setup(Fixtures.game, 'one'),
    state: State.empty({ seed: 7 }),
    maySuspend: true,
  });
  const recorder = yield* Recording.record(hosted, Fixtures.game);
  const watching = yield* Replay.alongside(hosted, Fixtures.setup(Fixtures.game, 'one')).pipe(
    Effect.forkChild,
  );
  const rewind = yield* Rewind.make(hosted, Fixtures.setup(Fixtures.game, 'one'), {
    every: 3,
    keepSeconds: 10,
  });
  yield* Fixtures.elapse(100);
  const before = yield* hosted.state;
  yield* hosted.reload(Fixtures.setup(Fixtures.brisk, 'two'));
  yield* Fixtures.visit(hosted, Fixtures.brisk);
  const recording = yield* recorder.recording;
  return { hosted, recorder, recording, watching, rewind, before };
});

describe('a game swapped for a new build', () => {
  it.effect('is recorded in a new segment, each with its build, replaying with its own', () =>
    Effect.gen(function* () {
      const { recording, recorder } = yield* reloaded;
      const { segments } = recording;
      const setups = [Fixtures.setup(Fixtures.game, 'one'), Fixtures.setup(Fixtures.brisk, 'two')];

      expect(segments.map(({ version }) => version.build)).toEqual([
        Option.some('one'),
        Option.some('two'),
      ]);
      expect(segments.at(-1)).toEqual(yield* recorder.segment);
      expect(
        yield* Effect.forEach(segments, (segment, index) =>
          Replay.check(setups[index] ?? Fixtures.setup(), segment),
        ),
      ).toEqual([Option.none(), Option.none()]);
    }),
  );

  it.effect('begins each segment at the state the host went on from', () =>
    Effect.gen(function* () {
      const { recording, before } = yield* reloaded;

      expect(
        recording.segments.map(({ first }) =>
          typeof first === 'object' && first !== null && 'tick' in first ? first.tick : undefined,
        ),
      ).toEqual([0, before.tick]);
    }),
  );

  it.effect('is not checked for determinism by another build', () =>
    Effect.gen(function* () {
      const { recording } = yield* reloaded;
      const first = yield* Effect.fromOption(Option.fromNullishOr(recording.segments[0]));

      const refused = yield* Replay.check(Fixtures.setup(Fixtures.brisk, 'two'), first).pipe(
        Effect.flip,
      );

      expect(refused._tag).toBe('OtherVersion');
    }),
  );

  it.effect(
    'is replayed by another build, saying so first, and where it comes apart is a change of code',
    () =>
      Effect.gen(function* () {
        const { recording } = yield* reloaded;
        const second = yield* Effect.fromOption(Option.fromNullishOr(recording.segments[1]));

        const replayed = yield* Replay.steps(Fixtures.setup(Fixtures.game, 'one'), second);

        expect(Option.map(replayed.version, Version.told)).toEqual(
          Option.some('recorded by build two, replayed by build one (no component changed)'),
        );
        expect(Option.map(replayed.divergence, ({ cause }) => cause)).toEqual(
          Option.some('ChangedCode'),
        );
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

  it.effect('is one stretch of time to go back in, across the reload, marked where it was', () =>
    Effect.gen(function* () {
      const { rewind, before } = yield* reloaded;

      const span = yield* rewind.span;

      expect(span.oldest).toBe(0);
      expect(span.reloads).toEqual([{ tick: before.tick, build: Option.some('two') }]);
      expect(Option.isSome(yield* rewind.stateAt(before.tick - 1))).toBe(true);
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
