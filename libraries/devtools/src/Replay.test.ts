import { describe, expect, it } from '@effect/vitest';
import { State } from '@lightocean/core';
import { Effect, Fiber, Option } from 'effect';
import * as Fixtures from '#src/fixtures.ts';
import * as Recording from '#src/Recording.ts';
import * as Replay from '#src/Replay.ts';

describe('replaying a segment', () => {
  it.effect('comes to the states the host stepped through', () =>
    Effect.gen(function* () {
      const { segment } = yield* Fixtures.recorded();

      const divergence = yield* Replay.check(Fixtures.setup(), segment);

      expect(divergence).toEqual(Option.none());
    }),
  );

  it.effect(
    'tells the first step and component where a game that does not replay comes apart',
    () =>
      Effect.gen(function* () {
        const drifting = Fixtures.drifting();
        const { segment } = yield* Fixtures.recorded(drifting);

        const divergence = yield* Replay.check(Fixtures.setup(drifting), segment);

        expect(divergence).toEqual(
          Option.some({
            tick: 4,
            where: { _tag: 'Component', name: 'Position' },
            cause: 'Nondeterminism',
          }),
        );
      }),
  );

  it.effect('tells a join that comes to another entity than it did', () =>
    Effect.gen(function* () {
      const { segment, entity } = yield* Fixtures.recorded();
      const crowded = {
        ...Fixtures.setup(),
        join: (state: State.State) => Fixtures.join(State.spawn(state, [])[0]),
      };

      const divergence = yield* Replay.check(crowded, segment);

      expect(divergence).toEqual(
        Option.some({
          tick: 3,
          where: { _tag: 'Joined', recorded: entity, replayed: entity + 1 },
          cause: 'Nondeterminism',
        }),
      );
    }),
  );
});

describe('replaying a segment in which the host went back in time', () => {
  it.effect('goes back with it, and comes to the states the host stepped through after', () =>
    Effect.gen(function* () {
      const hosted = yield* Fixtures.host();
      const recorder = yield* Recording.record(hosted, Fixtures.game);
      yield* Fixtures.elapse(100);
      const past = yield* hosted.state;
      yield* Fixtures.visit(hosted);

      yield* hosted.restore(past);
      yield* Fixtures.elapse(100);
      const segment = yield* recorder.segment;

      expect(segment.entries.some((entry) => entry._tag === 'Restored')).toBe(true);
      expect(yield* Replay.check(Fixtures.setup(), segment)).toEqual(Option.none());
    }),
  );
});

describe('replaying a join that gives back a player the state holds', () => {
  it.effect(
    'takes it as changing nothing, as when a page that came again is given its player',
    () =>
      Effect.gen(function* () {
        const { segment, entity } = yield* Fixtures.recorded();
        const back: Recording.Entry = { _tag: 'Joined', entity };
        const given = {
          ...segment,
          entries: [...segment.entries.filter(({ _tag }) => _tag !== 'Left'), back],
        };

        expect(yield* Replay.check(Fixtures.setup(), given)).toEqual(Option.none());
      }),
  );
});

describe('replaying beside a host', () => {
  it.effect('tells nothing while the game replays as it is played', () =>
    Effect.gen(function* () {
      const hosted = yield* Fixtures.host();
      const watching = yield* Replay.alongside(hosted, Fixtures.setup()).pipe(Effect.forkChild);

      yield* Fixtures.visit(hosted);
      yield* Fixtures.elapse(100);

      expect(watching.pollUnsafe()).toBeUndefined();
    }),
  );

  it.effect('tells where a game that does not replay comes apart, as it does', () =>
    Effect.gen(function* () {
      const drifting = Fixtures.drifting();
      const hosted = yield* Fixtures.host(drifting);
      yield* Fixtures.elapse(100);
      const watching = yield* Replay.alongside(hosted, Fixtures.setup(drifting)).pipe(
        Effect.forkChild,
      );
      yield* Effect.yieldNow;

      yield* Fixtures.visit(hosted, drifting);

      expect(yield* Fiber.join(watching)).toEqual({
        tick: 4,
        where: { _tag: 'Component', name: 'Position' },
        cause: 'Nondeterminism',
      });
    }),
  );
});
