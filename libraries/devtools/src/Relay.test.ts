import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import type * as Bridge from '#src/Bridge.ts';
import * as Relay from '#src/Relay.ts';

/** A connection that keeps what it was sent. */
const peer = <Message>() => {
  const received: Array<Message> = [];
  return {
    received,
    send: (message: Message) =>
      Effect.sync(() => {
        received.push(message);
      }),
  };
};

/** What `host` was asked, in order. */
const asks = (host: { readonly received: ReadonlyArray<Bridge.ToHost> }) =>
  host.received.flatMap((message) => (message._tag === 'Ask' ? [message] : []));

/** A relay with two hosts that said hello, the second last, and two tools. */
const relayed = Effect.gen(function* () {
  const relay = yield* Relay.make;
  const first = peer<Bridge.ToHost>();
  const second = peer<Bridge.ToHost>();
  yield* relay.fromHost(first, { _tag: 'Hello', host: 'horde-a', name: 'horde' });
  yield* relay.fromHost(second, { _tag: 'Hello', host: 'horde-b', name: 'horde' });
  return { relay, first, second, tool: peer<Relay.FromRelay>(), other: peer<Relay.FromRelay>() };
});

describe('a relay', () => {
  it.effect('lists the hosts that said hello, the newest last', () =>
    Effect.gen(function* () {
      const { relay, tool } = yield* relayed;

      yield* relay.fromTool(tool, { _tag: 'Hosts', id: 1 });

      expect(tool.received).toEqual([
        {
          _tag: 'Hosts',
          id: 1,
          hosts: [
            { host: 'horde-a', name: 'horde' },
            { host: 'horde-b', name: 'horde' },
          ],
        },
      ]);
    }),
  );

  it.effect(
    'asks the newest host unless told which, and hands its answer to the tool that asked alone',
    () =>
      Effect.gen(function* () {
        const { relay, second, tool, other } = yield* relayed;

        yield* relay.fromTool(tool, { _tag: 'Ask', id: 5, request: { _tag: 'Span' } });
        const asked = asks(second);
        yield* Effect.forEach(asked, ({ id }) =>
          relay.fromHost(second, { _tag: 'Answered', id, answer: { oldest: 0, newest: 9 } }),
        );

        expect(asked).toMatchObject([{ _tag: 'Ask', host: 'horde-b', request: { _tag: 'Span' } }]);
        expect(tool.received).toEqual([
          { _tag: 'Answered', id: 5, answer: { oldest: 0, newest: 9 } },
        ]);
        expect(other.received).toEqual([]);
      }),
  );

  it.effect('asks the host it is told to', () =>
    Effect.gen(function* () {
      const { relay, first, second, tool } = yield* relayed;

      yield* relay.fromTool(tool, {
        _tag: 'Ask',
        id: 5,
        host: 'horde-a',
        request: { _tag: 'Span' },
      });

      expect(first.received).toHaveLength(1);
      expect(second.received).toEqual([]);
    }),
  );

  it.effect('keeps apart the answers of tools that ask with the same id', () =>
    Effect.gen(function* () {
      const { relay, second, tool, other } = yield* relayed;

      yield* relay.fromTool(tool, { _tag: 'Ask', id: 1, request: { _tag: 'Span' } });
      yield* relay.fromTool(other, { _tag: 'Ask', id: 1, request: { _tag: 'Describe' } });
      const [toFirst, toSecond] = asks(second);
      yield* Effect.forEach(Option.toArray(Option.fromNullishOr(toSecond)), ({ id }) =>
        relay.fromHost(second, { _tag: 'Unanswered', id, reason: 'second' }),
      );
      yield* Effect.forEach(Option.toArray(Option.fromNullishOr(toFirst)), ({ id }) =>
        relay.fromHost(second, { _tag: 'Answered', id, answer: 'first' }),
      );

      expect(toFirst?.id).not.toBe(toSecond?.id);
      expect(tool.received).toEqual([{ _tag: 'Answered', id: 1, answer: 'first' }]);
      expect(other.received).toEqual([{ _tag: 'Unanswered', id: 1, reason: 'second' }]);
    }),
  );

  it.effect('refuses a request when no host, or not the one named, is there', () =>
    Effect.gen(function* () {
      const { relay, tool } = yield* relayed;
      const empty = yield* Relay.make;

      yield* empty.fromTool(tool, { _tag: 'Ask', id: 2, request: { _tag: 'Span' } });
      yield* relay.fromTool(tool, {
        _tag: 'Ask',
        id: 3,
        host: 'nowhere',
        request: { _tag: 'Span' },
      });

      expect(tool.received).toEqual([
        {
          _tag: 'Unanswered',
          id: 2,
          reason: 'no game is running: open it in a browser with the development server',
        },
        {
          _tag: 'Unanswered',
          id: 3,
          reason: 'no host is called nowhere: horde-a and horde-b are running',
        },
      ]);
    }),
  );

  it.effect(
    'forgets a host that went away, refusing what was asked of it and not yet answered',
    () =>
      Effect.gen(function* () {
        const { relay, second, tool } = yield* relayed;

        yield* relay.fromTool(tool, { _tag: 'Ask', id: 4, request: { _tag: 'Span' } });
        yield* relay.hostGone(second);
        yield* relay.fromTool(tool, { _tag: 'Hosts', id: 5 });

        expect(tool.received).toEqual([
          { _tag: 'Unanswered', id: 4, reason: 'horde-b went away before it answered' },
          { _tag: 'Hosts', id: 5, hosts: [{ host: 'horde-a', name: 'horde' }] },
        ]);
      }),
  );

  it.effect('drops what a tool that went away was still waiting for', () =>
    Effect.gen(function* () {
      const { relay, second, tool } = yield* relayed;

      yield* relay.fromTool(tool, { _tag: 'Ask', id: 6, request: { _tag: 'Span' } });
      yield* relay.toolGone(tool);
      yield* Effect.forEach(asks(second), ({ id }) =>
        relay.fromHost(second, { _tag: 'Answered', id, answer: 'late' }),
      );

      expect(tool.received).toEqual([]);
    }),
  );

  it.effect('leaves alone what is no message', () =>
    Effect.gen(function* () {
      const { relay, tool } = yield* relayed;

      yield* relay.fromTool(tool, 'nonsense');
      yield* relay.fromHost(peer(), { _tag: 'Answered', id: 999, answer: 'unasked' });

      expect(tool.received).toEqual([]);
    }),
  );

  it.effect(
    'hands a capture to the newest page showing the host asked for, and its shot back',
    () =>
      Effect.gen(function* () {
        const { relay, second, tool } = yield* relayed;
        const older = peer<Bridge.ToHost>();
        const newer = peer<Bridge.ToHost>();
        yield* relay.fromHost(older, { _tag: 'Showing', page: 'page-1', host: 'horde-b' });
        yield* relay.fromHost(newer, { _tag: 'Showing', page: 'page-2', host: 'horde-b' });

        yield* relay.fromTool(tool, { _tag: 'Capture', id: 3, width: 320 });
        const captures = newer.received.flatMap((message) =>
          message._tag === 'Capture' ? [message] : [],
        );
        yield* Effect.forEach(captures, ({ id }) =>
          relay.fromHost(newer, {
            _tag: 'Answered',
            id,
            answer: { png: 'iVBOR', width: 320, height: 200 },
          }),
        );

        expect(captures).toMatchObject([
          { _tag: 'Capture', page: 'page-2', width: Option.some(320) },
        ]);
        expect(older.received).toEqual([]);
        expect(second.received).toEqual([]);
        expect(tool.received).toEqual([
          { _tag: 'Answered', id: 3, answer: { png: 'iVBOR', width: 320, height: 200 } },
        ]);
      }),
  );

  it.effect(
    'refuses a capture when no page shows the host, and forgets a page that went away',
    () =>
      Effect.gen(function* () {
        const { relay, tool } = yield* relayed;
        const page = peer<Bridge.ToHost>();
        yield* relay.fromHost(page, { _tag: 'Showing', page: 'page-1', host: 'horde-b' });
        yield* relay.hostGone(page);

        yield* relay.fromTool(tool, { _tag: 'Capture', id: 4 });

        expect(tool.received).toEqual([
          {
            _tag: 'Unanswered',
            id: 4,
            reason: 'no page shows horde-b: open it in a browser with the development server',
          },
        ]);
      }),
  );

  it.effect('hands a press to the newest page that shows the host, and its answer back', () =>
    Effect.gen(function* () {
      const { relay, tool } = yield* relayed;
      const page = peer<Bridge.ToHost>();
      yield* relay.fromHost(page, { _tag: 'Showing', page: 'page-1', host: 'horde-b' });

      yield* relay.fromTool(tool, { _tag: 'Press', id: 5, key: 'KeyP', frames: 2 });
      const presses = page.received.flatMap((message) =>
        message._tag === 'Press' ? [message] : [],
      );
      yield* Effect.forEach(presses, ({ id }) =>
        relay.fromHost(page, { _tag: 'Answered', id, answer: { key: 'KeyP', frames: 2 } }),
      );

      expect(presses).toMatchObject([{ _tag: 'Press', page: 'page-1', key: 'KeyP', frames: 2 }]);
      expect(tool.received).toEqual([
        { _tag: 'Answered', id: 5, answer: { key: 'KeyP', frames: 2 } },
      ]);
    }),
  );
});
