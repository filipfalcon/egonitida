import { describe, expect, it } from '@effect/vitest';
import { Effect, Schema } from 'effect';
import * as Fixtures from '#src/fixtures.ts';
import * as Recording from '#src/Recording.ts';

describe('a segment', () => {
  it.effect('starts from the state as it was when segment began, as its game encodes it', () =>
    Effect.gen(function* () {
      const { segment } = yield* Fixtures.recorded();

      expect(segment.stepRate).toBe(30);
      expect(segment.first).toEqual({
        tick: 3,
        nextEntity: 0,
        nextLocal: -1,
        random: expect.any(Number),
        stores: {},
      });
    }),
  );

  it.effect('keeps every join, leave, and step after it, with its input', () =>
    Effect.gen(function* () {
      const { entity, segment } = yield* Fixtures.recorded();

      expect(segment.entries).toEqual([
        { _tag: 'Joined', entity },
        {
          _tag: 'Stepped',
          tick: 4,
          input: {
            demands: [{ entity, component: 'Stick', value: { move: 1 } }],
            actions: [{ _tag: 'AskedToHeal', amount: 50, player: entity }],
          },
          fingerprint: expect.anything(),
        },
        {
          _tag: 'Stepped',
          tick: 5,
          input: { demands: [], actions: [] },
          fingerprint: expect.anything(),
        },
        {
          _tag: 'Stepped',
          tick: 6,
          input: { demands: [], actions: [] },
          fingerprint: expect.anything(),
        },
        { _tag: 'Left', entity },
      ]);
    }),
  );

  it.effect('is data: it is the same after travelling as JSON', () =>
    Effect.gen(function* () {
      const { segment } = yield* Fixtures.recorded();
      const json = Schema.fromJsonString(Recording.Segment);

      const travelled = yield* Schema.decodeEffect(json)(yield* Schema.encodeEffect(json)(segment));

      expect(travelled).toEqual(segment);
    }),
  );
});
