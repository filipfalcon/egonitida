import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import * as Fixtures from '#src/fixtures.ts';
import * as Inspect from '#src/Inspect.ts';
import * as Rewind from '#src/Rewind.ts';

/** A host kept for inspecting, with a player who visited it: joined at tick 3, walked and was healed, and left at tick 6. */
const inspected = Effect.gen(function* () {
  const hosted = yield* Fixtures.host(Fixtures.game, true);
  const rewind = yield* Rewind.make(hosted, Fixtures.setup(), { every: 2, keepSeconds: 10 });
  const inspector = Inspect.make(hosted, rewind);
  yield* Fixtures.advance(100);
  const entity = yield* Fixtures.visit(hosted);
  return { hosted, inspector, entity };
});

/** Why `answering` was refused, if it was. */
const refusal = (answering: Effect.Effect<unknown, Inspect.Refused>) =>
  answering.pipe(
    Effect.match({
      onFailure: ({ reason }) => Option.some(reason),
      onSuccess: () => Option.none<string>(),
    }),
  );

describe('inspecting a hosted game', () => {
  it.effect('describes the game: its components, actions, and the parts that change each', () =>
    Effect.gen(function* () {
      const { inspector } = yield* inspected;

      const described = yield* inspector.answer({ _tag: 'Describe' });

      expect(described).toMatchObject({
        stepRate: 30,
        domains: ['Test'],
        components: expect.arrayContaining([
          expect.objectContaining({
            name: 'Position',
            owner: 'simulation',
            network: 'server',
            writtenBy: ['Test: steer'],
            schema: expect.objectContaining({ type: 'object' }),
          }),
          expect.objectContaining({ name: 'Health', writtenBy: ['Test: on AskedToHeal'] }),
        ]),
        actions: [
          expect.objectContaining({ tag: 'AskedToHeal', handledBy: ['Test: on AskedToHeal'] }),
        ],
      });
    }),
  );

  it.effect('tells the world at a tick, entity by entity, or one entity or component of it', () =>
    Effect.gen(function* () {
      const { inspector, entity } = yield* inspected;

      const whole = yield* inspector.answer({ _tag: 'World', tick: 5 });
      const one = yield* inspector.answer({ _tag: 'World', tick: 5, entity, component: 'Health' });

      expect(whole).toEqual({
        tick: 5,
        entities: { [entity]: { Position: { x: 2 }, Health: { current: 50 }, Stick: { move: 1 } } },
      });
      expect(one).toEqual({ tick: 5, entities: { [entity]: { Health: { current: 50 } } } });
    }),
  );

  it.effect('tells the world as it is now when given no tick', () =>
    Effect.gen(function* () {
      const { hosted, inspector } = yield* inspected;

      const now = yield* inspector.answer({ _tag: 'World' });

      expect(now).toEqual({ tick: (yield* hosted.world).tick, entities: {} });
    }),
  );

  it.effect('compares two ticks, component by component', () =>
    Effect.gen(function* () {
      const { inspector, entity } = yield* inspected;

      const compared = yield* inspector.answer({ _tag: 'Compare', from: 3, to: 5 });

      expect(compared).toEqual({
        from: 3,
        to: 5,
        components: {
          Position: { added: [], removed: [], changed: [{ entity, from: { x: 0 }, to: { x: 2 } }] },
          Health: {
            added: [],
            removed: [],
            changed: [{ entity, from: { current: 1 }, to: { current: 50 } }],
          },
          Stick: {
            added: [],
            removed: [],
            changed: [{ entity, from: { move: 0 }, to: { move: 1 } }],
          },
        },
      });
    }),
  );

  it.effect('tells the log of what happened after the world at one tick, up to another', () =>
    Effect.gen(function* () {
      const { inspector } = yield* inspected;

      const log = yield* inspector.answer({ _tag: 'Log', from: 3, to: 5 });

      expect(log).toEqual({
        text: [
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
        ].join('\n'),
      });
    }),
  );

  it.effect('tells the span of ticks it can tell of', () =>
    Effect.gen(function* () {
      const { inspector } = yield* inspected;

      expect(yield* inspector.answer({ _tag: 'Span' })).toEqual({ oldest: 0, newest: 6 });
    }),
  );

  it.effect('refuses a tick it does not keep, saying which it does', () =>
    Effect.gen(function* () {
      const { inspector } = yield* inspected;

      const refused = yield* refusal(inspector.answer({ _tag: 'World', tick: 99 }));

      expect(refused).toEqual(Option.some('tick 99 is not kept: ticks 0 to 6 are'));
    }),
  );

  it.effect('holds time, steps it as far as it is told, and lets it go', () =>
    Effect.gen(function* () {
      const { hosted, inspector } = yield* inspected;

      yield* inspector.answer({ _tag: 'Hold' });
      const held = (yield* hosted.world).tick;
      yield* Fixtures.advance(300);
      yield* inspector.answer({ _tag: 'Advance', steps: 2 });
      const stepped = (yield* hosted.world).tick;
      yield* inspector.answer({ _tag: 'Release' });
      yield* Fixtures.advance(100);

      expect(stepped).toBe(held + 2);
      expect((yield* hosted.world).tick).toBe(held + 5);
    }),
  );

  it.effect('plays on from a past tick, the time after it gone', () =>
    Effect.gen(function* () {
      const { hosted, inspector } = yield* inspected;

      yield* inspector.answer({ _tag: 'PlayFrom', tick: 4 });

      expect((yield* hosted.world).tick).toBe(4);
      expect(yield* inspector.answer({ _tag: 'Span' })).toEqual({ oldest: 0, newest: 4 });
    }),
  );

  it.effect('reads a request as it travels, and refuses one it cannot read', () =>
    Effect.gen(function* () {
      const { inspector } = yield* inspected;

      const span = yield* inspector.answerUnknown({ _tag: 'Span' });
      const refused = yield* refusal(inspector.answerUnknown({ _tag: 'Explode' }));

      expect(span).toEqual({ oldest: 0, newest: 6 });
      expect(Option.isSome(refused)).toBe(true);
    }),
  );
});
