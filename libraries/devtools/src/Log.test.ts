import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import * as Fixtures from '#src/fixtures.ts';
import * as Log from '#src/Log.ts';

const nothing = { spawned: [], despawned: [], emitted: [], issued: [] };

describe('the log of a segment', () => {
  it.effect('tells, step by step, what each part did and for what, and who joined and left', () =>
    Effect.gen(function* () {
      const { segment, entity } = yield* Fixtures.recorded();

      const lines = yield* Log.of(Fixtures.setup(), segment);

      const asked = { _tag: 'AskedToHeal', amount: 50, player: entity };
      const steered = {
        ...nothing,
        part: 'Test: steer',
        cause: Option.none(),
        set: { Position: [entity] },
      };
      expect(lines).toEqual([
        { _tag: 'Joined', tick: 3, entity },
        {
          _tag: 'Stepped',
          tick: 4,
          demands: Option.none(),
          actions: [asked],
          parts: [
            {
              ...nothing,
              part: 'Test: on AskedToHeal',
              cause: Option.some(asked),
              set: { Health: [entity] },
            },
            steered,
          ],
        },
        { _tag: 'Stepped', tick: 5, demands: Option.none(), actions: [], parts: [steered] },
        { _tag: 'Stepped', tick: 6, demands: Option.none(), actions: [], parts: [steered] },
        { _tag: 'Left', tick: 6, entity },
      ]);
    }),
  );

  it.effect('tells the demands that reached each step, when asked to', () =>
    Effect.gen(function* () {
      const { segment, entity } = yield* Fixtures.recorded();

      const lines = yield* Log.of(Fixtures.setup(), segment, { demands: true });

      expect(lines.flatMap((line) => (line._tag === 'Stepped' ? [line.demands] : []))).toEqual([
        Option.some([{ entity, component: 'Stick', value: { move: 1 } }]),
        Option.some([]),
        Option.some([]),
      ]);
    }),
  );

  it.effect('ends where the replay it is told from comes apart, saying where', () =>
    Effect.gen(function* () {
      const drifting = Fixtures.drifting();
      const { segment } = yield* Fixtures.recorded(drifting);

      const lines = yield* Log.of(Fixtures.setup(drifting), segment);

      expect(lines.at(-1)).toEqual({
        _tag: 'CameApart',
        tick: 4,
        where: { _tag: 'Component', name: 'Position' },
        cause: 'Nondeterminism',
      });
    }),
  );

  it.effect('reads as text, a step to a paragraph', () =>
    Effect.gen(function* () {
      const { segment } = yield* Fixtures.recorded();

      const text = Log.format(yield* Log.of(Fixtures.setup(), segment));

      expect(text).toBe(
        [
          'tick 3: entity 0 joined',
          '',
          'tick 4',
          '  action AskedToHeal {"amount":50,"player":0}',
          '  Test: on AskedToHeal {"amount":50,"player":0}',
          '    set Health of 0',
          '  Test: steer',
          '    set Position of 0',
          '',
          'tick 5',
          '  Test: steer',
          '    set Position of 0',
          '',
          'tick 6',
          '  Test: steer',
          '    set Position of 0',
          '',
          'tick 6: entity 0 left',
        ].join('\n'),
      );
    }),
  );
});
