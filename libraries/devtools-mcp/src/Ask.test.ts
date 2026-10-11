import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import * as Ask from '#src/Ask.ts';
import { served } from '#src/fixtures.ts';

/** Why `asking` came to nothing, if it did. */
const refusal = (asking: Effect.Effect<unknown, Ask.Failed>) =>
  asking.pipe(
    Effect.match({
      onFailure: ({ reason }) => Option.some(reason),
      onSuccess: () => Option.none<string>(),
    }),
  );

describe('asking a relay', () => {
  it.live('hands a request to the newest host, and its answer back', () =>
    Effect.gen(function* () {
      const listening = yield* served(['first', 'counting']);

      yield* Ask.request([listening], { _tag: 'Advance', steps: 3 });
      const world = yield* Ask.request([listening], { _tag: 'World' });

      expect(world).toEqual({ tick: 3, entities: { 0: { Count: { value: 3 } } } });
    }),
  );

  it.live('hands a request to the host it names', () =>
    Effect.gen(function* () {
      const listening = yield* served(['first', 'second']);
      const hosts = yield* Ask.hosts([listening]);
      const [first] = hosts;

      yield* Ask.request([listening], { _tag: 'Advance', steps: 2 }, first?.host);
      const world = yield* Ask.request([listening], { _tag: 'World' }, first?.host);
      const other = yield* Ask.request([listening], { _tag: 'World' });

      expect(hosts.map(({ name }) => name)).toEqual(['first', 'second']);
      expect(world).toMatchObject({ tick: 2 });
      expect(other).toMatchObject({ tick: 0 });
    }),
  );

  it.live('says why a request was refused', () =>
    Effect.gen(function* () {
      const listening = yield* served(['counting']);

      const refused = yield* refusal(Ask.request([listening], { _tag: 'World', tick: 99 }));

      expect(refused).toEqual(Option.some('tick 99 is not kept: ticks 0 to 0 are'));
    }),
  );

  it.live('says so when no development server is running', () =>
    Effect.gen(function* () {
      const refused = yield* refusal(Ask.request([], { _tag: 'Span' }));

      expect(refused).toEqual(
        Option.some(
          'no development server with the LightOcean devtools plugin is running in this workspace',
        ),
      );
    }),
  );
});
