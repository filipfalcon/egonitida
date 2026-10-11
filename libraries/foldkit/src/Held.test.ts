import { describe, expect, it } from '@effect/vitest';
import { Effect, Option, Ref } from 'effect';
import { ManagedResource } from 'foldkit';
import * as Held from '#src/Held.ts';

describe('a resource held for a test', () => {
  it.effect(
    'is what Foldkit gives a Command or a Subscription: nothing until it is held, then what it holds',
    () =>
      Effect.gen(function* () {
        const resource = ManagedResource.tag<string>()('Lamp');
        const held = yield* Ref.make(Option.none<string>());
        const got = resource.get.pipe(
          Effect.catchTag('ResourceNotAvailable', ({ resource }) =>
            Effect.succeed(`no ${resource}`),
          ),
          Held.holding(resource, held),
        );

        const before = yield* got;
        yield* Ref.set(held, Option.some('the lamp'));
        const after = yield* got;

        expect([before, after]).toEqual(['no Lamp', 'the lamp']);
      }),
  );
});
