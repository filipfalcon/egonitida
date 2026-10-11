import { describe, expect, it } from '@effect/vitest';
import { Client } from '@lightocean/core';
import { Transport } from '@lightocean/core/internal';
import { Effect } from 'effect';
import * as Debugger from '#src/Debugger.ts';
import * as Fixtures from '#src/fixtures.ts';
import * as Inspect from '#src/Inspect.ts';

describe('a debugger beside a host', () => {
  it.effect(
    "keeps the host's past and answers its clients' questions of it, with no development server",
    () =>
      Effect.gen(function* () {
        const hosted = yield* Fixtures.host(Fixtures.game, true);
        yield* Debugger.serve(hosted, Fixtures.setup(), { every: 2, keepSeconds: 10 });
        yield* Fixtures.advance(100);
        yield* Fixtures.visit(hosted);
        const [clientEnd, hostEnd] = yield* Transport.memoryPair;
        yield* hosted.connect(hostEnd);
        const client = yield* Client.connect(clientEnd, { game: Fixtures.game });

        const span = yield* Inspect.ask(client, { _tag: 'Span' });
        const steps = yield* Inspect.steps(client, { from: 3, to: 5 });

        expect(span).toEqual({ oldest: 0, newest: 6 });
        expect(steps.flatMap(({ actions }) => actions.map(({ tag }) => tag))).toEqual([
          'AskedToHeal',
        ]);
      }),
  );
});
