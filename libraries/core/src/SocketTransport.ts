import { type Cause, Effect, Option, Queue, type Scope, Stream } from 'effect';
import * as Socket from 'effect/socket/Socket';
import * as Transport from '#src/Transport.ts';

/**
 * A connection to a host over a socket, such as a WebSocket to a room in a Durable Object: both channels travel on the one socket, each frame marked with its channel, and the unreliable channel never loses anything, which a protocol written for loss does not mind. It is written against Effect's platform-neutral sockets, so the platform decides what a socket is: a browser's WebSocket, or one in memory in a test.
 */

/** A connection over `socket`, until the scope closes: what it reads, as frames, ends when the other end closes or a frame cannot be sent, as the socket is broken, and a frame sent after is lost, as the player has gone, without writing to the socket again. */
export const fromSocket = (
  socket: Socket.Socket,
): Effect.Effect<Transport.Connection, never, Scope.Scope> =>
  Effect.gen(function* () {
    const writer = yield* socket.writer;
    const inbox = yield* Queue.unbounded<Transport.Frame, Cause.Done>();
    /** Whether the socket is over: the other end closed it, or it broke. */
    const over = { now: false };
    const end = Effect.suspend(() => {
      over.now = true;
      return Queue.end(inbox);
    });
    yield* socket.reader.pipe(
      Effect.flatMap((reader) =>
        reader.pull.pipe(
          Effect.flatMap((chunks) =>
            Effect.forEach(chunks, (chunk) =>
              Option.match(
                // Frames are text; what comes as bytes is none of them.
                typeof chunk === 'string' ? Transport.decodeFrame(chunk) : Option.none(),
                {
                  // What is no frame is no one's to read.
                  onNone: () => Effect.void,
                  onSome: (frame) => Queue.offer(inbox, frame),
                },
              ),
            ),
          ),
          Effect.forever,
        ),
      ),
      // The other end closed, or the socket broke: there is nothing more to read.
      Effect.catch(() => end),
      Effect.forkScoped,
    );
    return {
      // Once the socket is over, a frame is lost, as the player has gone, and nothing more is written to it.
      send: (frame) =>
        Effect.suspend(() =>
          over.now
            ? Effect.void
            : writer.write(Transport.encodeFrame(frame)).pipe(
                // A socket that cannot be written to is broken: what it reads ends, so whoever reads it sees the connection is over.
                Effect.catch(() => end),
                Effect.asVoid,
              ),
        ),
      frames: Stream.fromQueue(inbox),
    };
  });

/** A connection over a WebSocket to `url`, until the scope closes, opened by the platform's WebSocket. */
export const connect = (
  url: string,
): Effect.Effect<Transport.Connection, never, Scope.Scope | Socket.WebSocketConstructor> =>
  Effect.flatMap(Socket.makeWebSocket(url), fromSocket);
