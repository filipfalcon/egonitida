import { describe, expect, it } from '@effect/vitest';
import { Effect, Option, Queue, Stream } from 'effect';
import type * as Bridge from '#src/Bridge.ts';
import * as Page from '#src/Page.ts';

/** A page drawing the host `horde-a`, over a channel in memory, whose captures come from `capture`. */
const paged = (capture: Page.Capture) =>
  Effect.gen(function* () {
    const sent = yield* Queue.unbounded<Bridge.FromHost>();
    const toPage = yield* Queue.unbounded<unknown>();
    yield* Page.serve(
      { send: (message) => Queue.offer(sent, message), received: Stream.fromQueue(toPage) },
      { host: 'horde-a', capture },
    );
    const hello = yield* Queue.take(sent);
    const page = hello._tag === 'Showing' ? hello.page : '';
    return { sent, toPage, hello, page };
  });

const shot = (width: Option.Option<number>) =>
  Effect.succeed({ png: 'iVBOR', width: Option.getOrElse(width, () => 640), height: 400 });

describe('a page that draws a host', () => {
  it.effect('says which host it draws, with an id of its own', () =>
    Effect.gen(function* () {
      const { hello } = yield* paged(shot);

      expect(hello).toEqual({ _tag: 'Showing', page: expect.any(String), host: 'horde-a' });
    }),
  );

  it.effect('answers a capture of it with a shot of what it draws, as wide as asked', () =>
    Effect.gen(function* () {
      const { sent, toPage, page } = yield* paged(shot);

      yield* Queue.offer(toPage, { _tag: 'Capture', id: 5, page, width: 320 });
      yield* Queue.offer(toPage, { _tag: 'Capture', id: 6, page: 'another', width: 320 });
      yield* Queue.offer(toPage, { _tag: 'Capture', id: 7, page });

      expect(yield* Queue.take(sent)).toEqual({
        _tag: 'Answered',
        id: 5,
        answer: { png: 'iVBOR', width: 320, height: 400 },
      });
      expect(yield* Queue.take(sent)).toMatchObject({
        _tag: 'Answered',
        id: 7,
        answer: { width: 640 },
      });
    }),
  );

  it.effect('says why it could not capture, and says hello again when asked who is there', () =>
    Effect.gen(function* () {
      const { sent, toPage, page, hello } = yield* paged(() =>
        Effect.fail('the renderer has not started'),
      );

      yield* Queue.offer(toPage, { _tag: 'Capture', id: 8, page });
      yield* Queue.offer(toPage, { _tag: 'Who' });

      expect(yield* Queue.take(sent)).toEqual({
        _tag: 'Unanswered',
        id: 8,
        reason: 'the renderer has not started',
      });
      expect(yield* Queue.take(sent)).toEqual(hello);
    }),
  );
});
