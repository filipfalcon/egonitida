import { describe, expect, it } from '@effect/vitest';
import { Effect, Queue, Stream } from 'effect';
import * as Bridge from '#src/Bridge.ts';
import * as Fixtures from '#src/fixtures.ts';
import * as Inspect from '#src/Inspect.ts';
import * as Rewind from '#src/Rewind.ts';

/** A host bridged over a channel in memory: what it sent, and a way to send it what a relay would. */
const bridged = Effect.gen(function* () {
  const hosted = yield* Fixtures.host(Fixtures.game, true);
  const rewind = yield* Rewind.make(hosted, Fixtures.setup(), { every: 2, keepSeconds: 10 });
  const sent = yield* Queue.unbounded<Bridge.FromHost>();
  const toHost = yield* Queue.unbounded<unknown>();
  const channel: Bridge.Channel = {
    send: (message) => Queue.offer(sent, message),
    received: Stream.fromQueue(toHost),
  };
  yield* Bridge.serve(channel, Inspect.make(hosted, rewind), { name: 'test' });
  yield* Fixtures.elapse(100);
  const hello = yield* Queue.take(sent);
  const host = hello._tag === 'Hello' ? hello.host : '';
  return { sent, toHost, hello, host };
});

describe('a bridge from a host', () => {
  it.effect('says hello, with an id of its own and its name', () =>
    Effect.gen(function* () {
      const { hello } = yield* bridged;

      expect(hello).toEqual({ _tag: 'Hello', host: expect.any(String), name: 'test' });
    }),
  );

  it.effect('answers what it is asked, with the id it was asked with', () =>
    Effect.gen(function* () {
      const { sent, toHost, host } = yield* bridged;

      yield* Queue.offer(toHost, { _tag: 'Ask', id: 7, host, request: { _tag: 'Span' } });

      expect(yield* Queue.take(sent)).toEqual({
        _tag: 'Answered',
        id: 7,
        answer: { oldest: 0, newest: 3 },
      });
    }),
  );

  it.effect('says why it refused, with the id it was asked with', () =>
    Effect.gen(function* () {
      const { sent, toHost, host } = yield* bridged;

      yield* Queue.offer(toHost, {
        _tag: 'Ask',
        id: 8,
        host,
        request: { _tag: 'State', tick: 99 },
      });

      expect(yield* Queue.take(sent)).toEqual({
        _tag: 'Unanswered',
        id: 8,
        reason: 'tick 99 is not kept: ticks 0 to 3 are',
      });
    }),
  );

  it.effect('leaves what is asked of another host, and what is no message, to others', () =>
    Effect.gen(function* () {
      const { sent, toHost, host } = yield* bridged;

      yield* Queue.offer(toHost, {
        _tag: 'Ask',
        id: 9,
        host: 'another',
        request: { _tag: 'Span' },
      });
      yield* Queue.offer(toHost, 'nonsense');
      yield* Queue.offer(toHost, { _tag: 'Ask', id: 10, host, request: { _tag: 'Span' } });

      expect(yield* Queue.take(sent)).toMatchObject({ _tag: 'Answered', id: 10 });
    }),
  );

  it.effect('says hello again whenever a relay asks who is there', () =>
    Effect.gen(function* () {
      const { sent, toHost, hello } = yield* bridged;

      yield* Queue.offer(toHost, { _tag: 'Who' });

      expect(yield* Queue.take(sent)).toEqual(hello);
    }),
  );

  it.effect('says when answering broke, and goes on answering', () =>
    Effect.gen(function* () {
      const sent = yield* Queue.unbounded<Bridge.FromHost>();
      const toHost = yield* Queue.unbounded<unknown>();
      const answers = { given: 0 };
      const breaking: Inspect.Inspector = {
        answer: () => Effect.succeed('fine'),
        answerUnknown: () =>
          Effect.suspend(() => {
            answers.given += 1;
            return answers.given === 1
              ? Effect.die(new Error('the step threw'))
              : Effect.succeed('fine');
          }),
      };
      yield* Bridge.serve(
        { send: (message) => Queue.offer(sent, message), received: Stream.fromQueue(toHost) },
        breaking,
        {
          name: 'test',
        },
      );
      const hello = yield* Queue.take(sent);
      const host = hello._tag === 'Hello' ? hello.host : '';

      yield* Queue.offer(toHost, { _tag: 'Ask', id: 1, host, request: { _tag: 'Span' } });
      const broke = yield* Queue.take(sent);
      yield* Queue.offer(toHost, { _tag: 'Ask', id: 2, host, request: { _tag: 'Span' } });

      expect(broke).toEqual({
        _tag: 'Unanswered',
        id: 1,
        reason: expect.stringContaining('the step threw'),
      });
      expect(yield* Queue.take(sent)).toEqual({ _tag: 'Answered', id: 2, answer: 'fine' });
    }),
  );
});
