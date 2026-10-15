import { describe, expect, it } from '@effect/vitest';
import { Client } from '@egonitida/core';
import { Transport } from '@egonitida/core/internal';
import { Effect, Option, Schema } from 'effect';
import * as Fixtures from '#src/fixtures.ts';
import * as Inspect from '#src/Inspect.ts';
import * as Rewind from '#src/Rewind.ts';

/** A host kept for inspecting, with a player who visited it: joined at tick 3, walked and was healed, and left at tick 6. */
const inspected = Effect.gen(function* () {
  const hosted = yield* Fixtures.host(Fixtures.game, true);
  const rewind = yield* Rewind.make(hosted, Fixtures.setup(), { every: 2, keepSeconds: 10 });
  const inspector = Inspect.make(hosted, rewind);
  yield* Fixtures.elapse(100);
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

  it.effect('tells the state at a tick, entity by entity, or one entity or component of it', () =>
    Effect.gen(function* () {
      const { inspector, entity } = yield* inspected;

      const whole = yield* inspector.answer({ _tag: 'State', tick: 5 });
      const one = yield* inspector.answer({ _tag: 'State', tick: 5, entity, component: 'Health' });

      expect(whole).toEqual({
        tick: 5,
        entities: { [entity]: { Position: { x: 2 }, Health: { current: 50 }, Stick: { move: 1 } } },
      });
      expect(one).toEqual({ tick: 5, entities: { [entity]: { Health: { current: 50 } } } });
      expect(yield* inspector.answer({ _tag: 'State', tick: 5, component: 'Splat' })).toEqual({
        tick: 5,
        entities: {},
      });
    }),
  );

  it.effect('tells the state as it is now when given no tick', () =>
    Effect.gen(function* () {
      const { hosted, inspector } = yield* inspected;

      const now = yield* inspector.answer({ _tag: 'State' });

      expect(now).toEqual({ tick: (yield* hosted.state).tick, entities: {} });
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

  it.effect('tells the log of what happened after the state at one tick, up to another', () =>
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

  it.effect(
    'tells the steps after one tick, up to another, as data: what players did, and what each part set',
    () =>
      Effect.gen(function* () {
        const { inspector } = yield* inspected;

        const steps = yield* inspector.answer({ _tag: 'Steps', from: 3, to: 5 });

        expect(yield* Schema.decodeUnknownEffect(Inspect.Steps)(steps)).toEqual([
          {
            tick: 4,
            actions: [{ tag: 'AskedToHeal', fields: '{"amount":50,"player":0}' }],
            parts: [
              { part: 'Test: on AskedToHeal', set: { Health: [0] }, spawned: [], despawned: [] },
              { part: 'Test: steer', set: { Position: [0] }, spawned: [], despawned: [] },
            ],
          },
          {
            tick: 5,
            actions: [],
            parts: [{ part: 'Test: steer', set: { Position: [0] }, spawned: [], despawned: [] }],
          },
        ]);
      }),
  );

  it.effect("answers the questions a host's clients ask, as a debugger on a page asks them", () =>
    Effect.gen(function* () {
      const { hosted, inspector } = yield* inspected;
      yield* Inspect.answering(hosted, inspector);
      const [clientEnd, hostEnd] = yield* Transport.memoryPair;
      yield* hosted.connect(hostEnd);
      const client = yield* Client.connect(clientEnd, { game: Fixtures.game });

      const span = yield* Inspect.ask(client, { _tag: 'Span' });
      const steps = yield* Inspect.steps(client, { from: 3, to: 4 });

      expect(span).toEqual({ oldest: 0, newest: 6, reloads: [] });
      expect(steps.map(({ tick }) => tick)).toEqual([4]);
    }),
  );

  it.effect('tells the span of ticks it can tell of', () =>
    Effect.gen(function* () {
      const { inspector } = yield* inspected;

      expect(yield* inspector.answer({ _tag: 'Span' })).toEqual({
        oldest: 0,
        newest: 6,
        reloads: [],
      });
    }),
  );

  it.effect('refuses a tick it does not keep, saying which it does', () =>
    Effect.gen(function* () {
      const { inspector } = yield* inspected;

      const refused = yield* refusal(inspector.answer({ _tag: 'State', tick: 99 }));

      expect(refused).toEqual(Option.some('tick 99 is not kept: ticks 0 to 6 are'));
    }),
  );

  it.effect('suspends time, steps it as far as it is told, and resumes it', () =>
    Effect.gen(function* () {
      const { hosted, inspector } = yield* inspected;

      yield* inspector.answer({ _tag: 'Suspend' });
      const suspended = (yield* hosted.state).tick;
      yield* Fixtures.elapse(300);
      yield* inspector.answer({ _tag: 'Step', count: 2 });
      const stepped = (yield* hosted.state).tick;
      yield* inspector.answer({ _tag: 'Resume' });
      yield* Fixtures.elapse(100);

      expect(stepped).toBe(suspended + 2);
      expect((yield* hosted.state).tick).toBe(suspended + 5);
    }),
  );

  it.effect('plays on from a past tick, the time after it gone', () =>
    Effect.gen(function* () {
      const { hosted, inspector } = yield* inspected;

      yield* inspector.answer({ _tag: 'PlayFrom', tick: 4 });

      expect((yield* hosted.state).tick).toBe(4);
      expect(yield* inspector.answer({ _tag: 'Span' })).toEqual({
        oldest: 0,
        newest: 4,
        reloads: [],
      });
    }),
  );

  it.effect('reads a request as it travels, and refuses one it cannot read', () =>
    Effect.gen(function* () {
      const { inspector } = yield* inspected;

      const span = yield* inspector.answerUnknown({ _tag: 'Span' });
      const refused = yield* refusal(inspector.answerUnknown({ _tag: 'Explode' }));

      expect(span).toEqual({ oldest: 0, newest: 6, reloads: [] });
      expect(Option.isSome(refused)).toBe(true);
    }),
  );

  it.effect('plays players it joins, by demands and actions the game reads, and lets them go', () =>
    Effect.gen(function* () {
      const { hosted, inspector } = yield* inspected;
      yield* inspector.answer({ _tag: 'Suspend' });

      const { entity } = yield* Schema.decodeUnknownEffect(Schema.Struct({ entity: Schema.Int }))(
        yield* inspector.answer({ _tag: 'Join' }),
      );
      yield* inspector.answer({ _tag: 'Demand', entity, values: { Stick: { move: 3 } } });
      yield* inspector.answer({ _tag: 'Act', entity, action: { _tag: 'AskedToHeal', amount: 7 } });
      yield* inspector.answer({ _tag: 'Step', count: 1 });
      const played = yield* inspector.answer({ _tag: 'State', entity });
      yield* inspector.answer({ _tag: 'Leave', entity });
      const refused = yield* refusal(
        inspector.answer({ _tag: 'Demand', entity, values: { Health: { current: 1 } } }),
      );

      expect(played).toEqual({
        tick: (yield* hosted.state).tick,
        entities: { [entity]: { Position: { x: 3 }, Health: { current: 7 }, Stick: { move: 3 } } },
      });
      expect(refused).toEqual(Option.some('Health is no demand of the game'));
    }),
  );

  it.effect('writes what happened between two ticks as a story test', () =>
    Effect.gen(function* () {
      const { inspector } = yield* inspected;

      const written = yield* inspector.answer({
        _tag: 'Story',
        from: 3,
        to: 5,
        title: 'heals a player who asks',
        game: { from: '#src/game.ts', name: 'game' },
      });
      const refused = yield* refusal(
        inspector.answer({
          _tag: 'Story',
          from: 4,
          to: 6,
          title: 'leaves',
          game: { from: '#src/game.ts', name: 'game' },
        }),
      );

      expect(written).toEqual({ source: expect.stringContaining('    Story.steps(2),') });
      expect(refused).toEqual(
        Option.some('a player left at tick 6: tell a stretch that ends before it'),
      );
    }),
  );
});
