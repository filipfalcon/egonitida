import { Data, Effect, Option, Queue, type Scope, Stream } from 'effect';
import * as Transport from '#src/Transport.ts';

/**
 * A client's connection over a WebSocket, the fallback while servers cannot offer WebTransport. Both channels share the one socket. A WebSocket never loses anything, so the unreliable channel loses on purpose instead: a frame that would only queue behind frames not yet sent is already stale, and it is dropped the way a datagram would be.
 */

export class ConnectError extends Data.TaggedError('ConnectError')<{
  readonly url: string;
}> {}

// Bytes waiting in the socket's buffer beyond which an unreliable frame is not worth sending.
const STALE_AFTER_BYTES = 16 * 1024;

export interface WebSocketConnection {
  readonly connection: Transport.Connection;
  /** How many unreliable frames were dropped as stale so far. */
  readonly droppedUnreliable: () => number;
}

const open = (url: string) =>
  Effect.acquireRelease(
    Effect.callback<WebSocket, ConnectError>((resume) => {
      const socket = new WebSocket(url);
      socket.addEventListener('open', () => resume(Effect.succeed(socket)), { once: true });
      socket.addEventListener('error', () => resume(Effect.fail(new ConnectError({ url }))), {
        once: true,
      });
    }),
    (socket) => Effect.sync(() => socket.close()),
  );

export const connect = (
  url: string,
): Effect.Effect<WebSocketConnection, ConnectError, Scope.Scope> =>
  Effect.gen(function* () {
    const socket = yield* open(url);
    const inbox = yield* Queue.unbounded<Transport.Frame>();
    socket.addEventListener('message', (event) => {
      if (typeof event.data === 'string') {
        Option.map(Transport.decodeFrame(event.data), (frame) => Queue.offerUnsafe(inbox, frame));
      }
    });
    const counters = { droppedUnreliable: 0 };
    return {
      connection: {
        send: (frame) =>
          Effect.sync(() => {
            if (frame.channel === 'unreliable' && socket.bufferedAmount > STALE_AFTER_BYTES) {
              counters.droppedUnreliable += 1;
              return;
            }
            socket.send(Transport.encodeFrame(frame));
          }),
        frames: Stream.fromQueue(inbox),
      },
      droppedUnreliable: () => counters.droppedUnreliable,
    };
  });
