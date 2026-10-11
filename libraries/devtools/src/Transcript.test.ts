import { describe, expect, it } from '@effect/vitest';
import { Story } from '@lightocean/core';
import { Effect, Option, Result } from 'effect';
import * as Fixtures from '#src/fixtures.ts';
import * as Rewind from '#src/Rewind.ts';
import * as Transcript from '#src/Transcript.ts';

/** A player who joined at tick 3, walked and asked to be healed at tick 4, and left at tick 6; and the rewind that kept it. */
const visited = Effect.gen(function* () {
  const hosted = yield* Fixtures.host(Fixtures.game, true);
  const rewind = yield* Rewind.make(hosted, Fixtures.setup(), { every: 2, keepSeconds: 10 });
  yield* Fixtures.advance(100);
  yield* Fixtures.visit(hosted);
  return rewind;
});

/** The transcript of the ticks from `from` to `to`, or why there is none. */
const transcribed = (from: number, to: number) =>
  Effect.gen(function* () {
    const rewind = yield* visited;
    const stretch = yield* rewind.between(from, to);
    const end = yield* rewind.worldAt(to);
    return Option.match(Option.all([stretch, end]), {
      onNone: () => Result.fail('not kept'),
      onSome: ([{ world, entries }, last]) => Transcript.of(Fixtures.setup(), world, entries, last),
    });
  });

describe('a stretch of a recording, told as a story', () => {
  it.effect(
    'starts from the world at the first tick, plays what went in, and expects what came of it',
    () =>
      Effect.gen(function* () {
        const told = yield* transcribed(3, 5);

        expect(told).toEqual(
          Result.succeed([
            { _tag: 'GivenAs', world: expect.anything(), names: { e0: 0 } },
            { _tag: 'InputAs', name: 'e0', component: 'Stick', value: { move: 1 } },
            { _tag: 'ActAs', name: 'e0', action: { _tag: 'AskedToHeal', amount: 50 } },
            { _tag: 'Steps', count: 2 },
            { _tag: 'ExpectAs', name: 'e0', component: 'Position', value: { x: 2 } },
            { _tag: 'ExpectAs', name: 'e0', component: 'Health', value: { current: 50 } },
            { _tag: 'ExpectAs', name: 'e0', component: 'Stick', value: { move: 1 } },
          ]),
        );
      }),
  );

  it.effect('holds when told again with the game itself', () =>
    Effect.gen(function* () {
      const told = yield* transcribed(3, 5);

      expect(() =>
        Story.story(Fixtures.game, ...Transcript.steps(Result.getOrThrow(told))),
      ).not.toThrow();
    }),
  );

  it.effect('reads as the source of a story test', () =>
    Effect.gen(function* () {
      const told = Result.getOrThrow(yield* transcribed(3, 5));

      const source = Transcript.source(told, {
        title: 'heals a player who asks',
        game: { from: '#src/game.ts', name: 'game' },
      });

      expect(source).toContain("import { game } from '#src/game.ts';");
      expect(source).toContain("it('heals a player who asks', () => {");
      expect(source).toContain("    Story.inputAs('e0', 'Stick', {\"move\":1}),");
      expect(source).toContain('    Story.actAs(\'e0\', {"_tag":"AskedToHeal","amount":50}),');
      expect(source).toContain('    Story.steps(2),');
      expect(source).toContain("    Story.expectAs('e0', 'Health', {\"current\":50}),");
    }),
  );

  it.effect('refuses a stretch in which a player joins or leaves, saying where to start', () =>
    Effect.gen(function* () {
      expect(yield* transcribed(4, 6)).toEqual(
        Result.fail('a player left at tick 6: tell a stretch that ends before it'),
      );
    }),
  );
});
