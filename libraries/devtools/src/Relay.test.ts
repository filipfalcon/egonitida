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
          relay.fromHost(second, { _tag: 'Answer', id, answer: { oldest: 0, newest: 9 } }),
        );

        expect(asked).toMatchObject([{ _tag: 'Ask', host: 'horde-b', request: { _tag: 'Span' } }]);
        expect(tool.received).toEqual([
          { _tag: 'Answer', id: 5, answer: { oldest: 0, newest: 9 } },
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
        relay.fromHost(second, { _tag: 'Refusal', id, reason: 'second' }),
      );
      yield* Effect.forEach(Option.toArray(Option.fromNullishOr(toFirst)), ({ id }) =>
        relay.fromHost(second, { _tag: 'Answer', id, answer: 'first' }),
      );

      expect(toFirst?.id).not.toBe(toSecond?.id);
      expect(tool.received).toEqual([{ _tag: 'Answer', id: 1, answer: 'first' }]);
      expect(other.received).toEqual([{ _tag: 'Refusal', id: 1, reason: 'second' }]);
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
          _tag: 'Refusal',
          id: 2,
          reason: 'no game is running: open it in a browser with the development server',
        },
        {
          _tag: 'Refusal',
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
          { _tag: 'Refusal', id: 4, reason: 'horde-b went away before it answered' },
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
        relay.fromHost(second, { _tag: 'Answer', id, answer: 'late' }),
      );

      expect(tool.received).toEqual([]);
    }),
  );

  it.effect('leaves alone what is no message', () =>
    Effect.gen(function* () {
      const { relay, tool } = yield* relayed;

      yield* relay.fromTool(tool, 'nonsense');
      yield* relay.fromHost(peer(), { _tag: 'Answer', id: 999, answer: 'unasked' });

      expect(tool.received).toEqual([]);
    }),
  );
});
