import { describe, expect, it } from '@effect/vitest';
import { Effect, Fiber, Option, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import * as Transport from '#src/Transport.ts';

const reliable = (payload: string): Transport.Frame => ({ channel: 'reliable', payload });
const unreliable = (payload: string): Transport.Frame => ({ channel: 'unreliable', payload });

/** A random source that returns the given values in turn, so loss is decided by the test. */
const sequence = (values: ReadonlyArray<number>) => {
  const state = { index: 0 };
  return () => values[state.index++ % values.length] ?? 0;
};

const receive = (connection: Transport.Connection, count: number) =>
  connection.frames.pipe(Stream.take(count), Stream.runCollect);

describe('Transport', () => {
  describe('frames', () => {
    it('carries a frame on either channel through one text message and back', () => {
      for (const frame of [reliable('{"a":1}'), unreliable('x')]) {
        expect(Transport.decodeFrame(Transport.encodeFrame(frame))).toEqual(Option.some(frame));
      }
    });

    it('rejects a text message that names no channel', () => {
      expect(Transport.decodeFrame('?{"a":1}')).toEqual(Option.none());
      expect(Transport.decodeFrame('')).toEqual(Option.none());
    });
  });

  describe('in memory', () => {
    it.effect('delivers what each end sends to the other, in order', () =>
      Effect.gen(function* () {
        const [client, server] = yield* Transport.memoryPair;

        yield* client.send(reliable('one'));
        yield* client.send(unreliable('two'));
        yield* server.send(reliable('back'));

        const atServer = yield* receive(server, 2);
        expect(atServer).toEqual([reliable('one'), unreliable('two')]);
        const atClient = yield* receive(client, 1);
        expect(atClient).toEqual([reliable('back')]);
      }),
    );
  });

  describe('conditions', () => {
    it.effect('loses unreliable frames at the given rate, and never reliable ones', () =>
      Effect.gen(function* () {
        const [client, server] = yield* Transport.memoryPair;
        const lossy = yield* Transport.withConditions(client, {
          latencyMillis: 0,
          loss: 0.5,
          random: sequence([0.1, 0.9]),
        });

        // 0.1 falls under the loss rate and is lost; 0.9 does not.
        yield* lossy.send(unreliable('lost'));
        yield* lossy.send(unreliable('kept'));
        yield* lossy.send(reliable('always'));

        const received = yield* receive(server, 2);
        expect(received).toEqual([unreliable('kept'), reliable('always')]);
      }),
    );

    it.effect('delivers a frame only once the latency has passed', () =>
      Effect.gen(function* () {
        const [client, server] = yield* Transport.memoryPair;
        const delayed = yield* Transport.withConditions(client, {
          latencyMillis: 100,
          loss: 0,
          random: sequence([1]),
        });

        yield* delayed.send(reliable('late'));
        const arriving = yield* Effect.forkChild(receive(server, 1));

        yield* TestClock.adjust('99 millis');
        expect(arriving.pollUnsafe()).toBeUndefined();

        yield* TestClock.adjust('1 millis');
        const arrived = yield* Fiber.join(arriving);
        expect(arrived).toEqual([reliable('late')]);
      }),
    );

    it.effect('keeps reliable frames in order under latency', () =>
      Effect.gen(function* () {
        const [client, server] = yield* Transport.memoryPair;
        const delayed = yield* Transport.withConditions(client, {
          latencyMillis: 50,
          loss: 0,
          random: sequence([1]),
        });

        for (const payload of ['a', 'b', 'c']) {
          yield* delayed.send(reliable(payload));
        }
        const arriving = yield* Effect.forkChild(receive(server, 3));
        yield* TestClock.adjust('50 millis');

        const all = yield* Fiber.join(arriving);
        expect(all).toEqual([reliable('a'), reliable('b'), reliable('c')]);
      }),
    );
  });
});
