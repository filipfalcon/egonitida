import { describe, expect, it } from '@effect/vitest';
import { Effect, Queue, Stream } from 'effect';
import * as Beside from '#src/Beside.ts';
import type * as Bridge from '#src/Bridge.ts';
import * as Fixtures from '#src/fixtures.ts';

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
});
