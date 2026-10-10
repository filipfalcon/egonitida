import { describe, expect, it } from '@effect/vitest';
import { Option } from 'effect';
import * as Protocol from '#src/protocol.ts';

describe('protocol', () => {
  it('carries what a client sends without guarantee there and back', () => {
    const messages: ReadonlyArray<Protocol.ClientUnreliable> = [
      {
        _tag: 'Inputs',
        inputs: [
          { seq: 3, move: [1, 0] },
          { seq: 2, move: [0, -0.5] },
        ],
      },
      { _tag: 'Ping', sentAt: 123.5 },
    ];

    for (const message of messages) {
      const encoded = Protocol.encodeClientUnreliable(message);
      expect(Protocol.decodeClientUnreliable(encoded)).toEqual(Option.some(message));
    }
  });

  it('carries what a server sends reliably there and back', () => {
    const message: Protocol.ServerReliable = { _tag: 'Welcome', playerId: 'a', stepRate: 30 };

    expect(Protocol.decodeServerReliable(Protocol.encodeServerReliable(message))).toEqual(
      Option.some(message),
    );
  });

  it('carries what a server sends without guarantee there and back', () => {
    const messages: ReadonlyArray<Protocol.ServerUnreliable> = [
      { _tag: 'Snapshot', tick: 42, players: [{ id: 'a', position: [1, 2], lastSeq: 7 }] },
      { _tag: 'Pong', sentAt: 123.5, tick: 42 },
    ];

    for (const message of messages) {
      const encoded = Protocol.encodeServerUnreliable(message);
      expect(Protocol.decodeServerUnreliable(encoded)).toEqual(Option.some(message));
    }
  });

  it('rejects what is not a message, instead of trusting it', () => {
    expect(Protocol.decodeClientUnreliable('not json')).toEqual(Option.none());
    expect(Protocol.decodeClientUnreliable(JSON.stringify({ _tag: 'Teleport' }))).toEqual(
      Option.none(),
    );
    expect(
      Protocol.decodeClientUnreliable(
        JSON.stringify({ _tag: 'Inputs', inputs: [{ seq: 'x', move: [1, 0] }] }),
      ),
    ).toEqual(Option.none());
  });

  it('rejects a move longer than one, so a client cannot run faster', () => {
    const cheat = { _tag: 'Inputs', inputs: [{ seq: 1, move: [5, 0] }] };

    expect(Protocol.decodeClientUnreliable(JSON.stringify(cheat))).toEqual(Option.none());
  });

  it('rejects more inputs in one message than a client ever repeats', () => {
    const inputs = Array.from({ length: Protocol.MAX_REPEATED_INPUTS + 1 }, (_, index) => ({
      seq: index + 1,
      move: [0, 0],
    }));

    expect(Protocol.decodeClientUnreliable(JSON.stringify({ _tag: 'Inputs', inputs }))).toEqual(
      Option.none(),
    );
  });
});
