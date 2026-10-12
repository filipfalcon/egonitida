import { describe, expect, it } from '@effect/vitest';
import { State } from '@lightocean/core';
import { Transport } from '@lightocean/core/internal';
import { Effect, Option, Queue, Stream } from 'effect';
import * as Beside from '#src/Beside.ts';
import type * as Bridge from '#src/Bridge.ts';
import * as Fixtures from '#src/fixtures.ts';
import * as Keep from '#src/Keep.ts';

describe('the devtools beside a host', () => {
  it.effect('bridge the host to a relay, by the id given, with time kept to go back in', () =>
    Effect.gen(function* () {
      const hosted = yield* Fixtures.host(Fixtures.game, true);
      const sent = yield* Queue.unbounded<Bridge.FromHost>();
      const toHost = yield* Queue.unbounded<unknown>();
      yield* Beside.serve(hosted, Fixtures.setup(), {
        name: 'test',
        id: 'test-page-1',
        channel: {
          send: (message) => Queue.offer(sent, message),
          received: Stream.fromQueue(toHost),
        },
      });
      yield* Fixtures.advance(100);

      const hello = yield* Queue.take(sent);
      yield* Queue.offer(toHost, {
        _tag: 'Ask',
        id: 1,
        host: 'test-page-1',
        request: { _tag: 'Span' },
      });

      expect(hello).toEqual({ _tag: 'Hello', host: 'test-page-1', name: 'test' });
      expect(yield* Queue.take(sent)).toEqual({
        _tag: 'Answer',
        id: 1,
        answer: { oldest: 0, newest: 3 },
      });
    }),
  );

  it.effect('host a game from the state kept for the tab, and keep it on', () =>
    Effect.gen(function* () {
      const store = Keep.memory();
      const first = yield* Fixtures.host();
      yield* Keep.serve(store, first, Fixtures.game, { key: 'tab-1', everyMillis: 50 });
      yield* Fixtures.visit(first);
      yield* first.hold;
      yield* Fixtures.advance(100);
      const left = yield* first.state;
      const served: Array<number> = [];

      yield* Beside.host(
        { ...Fixtures.setup(), state: State.empty({ seed: 7 }), mayHold: true },
        { name: 'test', id: 'tab-1', kept: {}, store: Option.some(store) },
        (hosted) =>
          Effect.map(hosted.state, ({ tick }) => {
            served.push(tick);
          }),
      );

      expect(served).toEqual([left.tick]);
    }),
  );

  it.effect(
    'give the client that joins first the player kept for it, if the state still holds it',
    () =>
      Effect.gen(function* () {
        const store = Keep.memory();
        const first = yield* Fixtures.host();
        yield* Keep.serve(store, first, Fixtures.game, { key: 'tab-1', everyMillis: 50 });
        const [, firstEnd] = yield* Transport.memoryPair;
        const player = yield* first.connect(firstEnd);
        yield* Fixtures.advance(100);
        const joined: Array<number> = [];

        yield* Beside.host(
          { ...Fixtures.setup(), state: State.empty({ seed: 7 }), mayHold: true },
          { name: 'test', id: 'tab-1', kept: {}, store: Option.some(store) },
          (hosted) =>
            Effect.gen(function* () {
              const [, again] = yield* Transport.memoryPair;
              const [, another] = yield* Transport.memoryPair;
              joined.push(yield* hosted.connect(again), yield* hosted.connect(another));
            }),
        );

        expect(joined[0]).toBe(player);
        expect(joined[1]).not.toBe(player);
      }),
  );
});
