import { Effect, Exit, Queue, Scope, Stream } from 'effect';
import * as Worker from 'effect/workers/Worker';
import type { WorkerError } from 'effect/workers/WorkerError';
import * as WorkerRunner from 'effect/workers/WorkerRunner';
import * as Host from '#src/Host.ts';
import type * as Transport from '#src/Transport.ts';

/**
 * A session between a page and a host running in a worker, for singleplayer: the same host a Durable Object runs, on the player's own machine, off the main thread. It is written against Effect's platform-neutral workers, so the platform decides what a worker is: a Web Worker, a shared worker, or a message port in a test.
 *
 * A worker has no notion of a connection opening, so the page says hello first, and a port's first frame is what joins it.
 */

const hello: Transport.Frame = { channel: 'reliable', payload: '' };

/** The page's side: a connection to the host in the worker the platform spawns. */
export const connect: Effect.Effect<
  Transport.Connection,
  WorkerError,
  Worker.WorkerPlatform | Worker.Spawner | Scope.Scope
> = Effect.gen(function* () {
  const platform = yield* Worker.WorkerPlatform;
  const worker = yield* platform.spawn<Transport.Frame, Transport.Frame>(0);
  const inbox = yield* Queue.unbounded<Transport.Frame>();
  yield* worker.run((frame) => Queue.offer(inbox, frame)).pipe(Effect.forkScoped);
  const connection: Transport.Connection = {
    // A worker that can no longer take a frame is gone, which is a defect rather than a frame to lose.
    send: (frame) => worker.send(frame).pipe(Effect.orDie),
    frames: Stream.fromQueue(inbox),
  };
  yield* connection.send(hello);
  return connection;
});

/** The worker's side: hosts a game for every page that connects, until the scope closes, running its commands with the `Services` it is given. */
export const serve = <Services = never>(
  options: Host.Options<Services>,
): Effect.Effect<void, WorkerError, WorkerRunner.WorkerRunnerPlatform | Scope.Scope | Services> =>
  Effect.gen(function* () {
    const host = yield* Host.make(options);
    const runner = yield* (yield* WorkerRunner.WorkerRunnerPlatform).start<
      Transport.Frame,
      Transport.Frame
    >();
    const parent = yield* Effect.scope;
    const ports = new Map<
      number,
      { readonly inbox: Queue.Queue<Transport.Frame>; readonly scope: Scope.Closeable }
    >();

    // Frames are handled one at a time, in arrival order, so a port's first two frames cannot both join it.
    const incoming = yield* Queue.unbounded<readonly [number, Transport.Frame]>();
    yield* Stream.fromQueue(incoming).pipe(
      Stream.runForEach(([portId, frame]) =>
        Effect.gen(function* () {
          const known = ports.get(portId);
          if (known !== undefined) {
            yield* Queue.offer(known.inbox, frame);
            return;
          }
          const port = {
            inbox: yield* Queue.unbounded<Transport.Frame>(),
            scope: yield* Scope.make(),
          };
          ports.set(portId, port);
          yield* Scope.addFinalizer(parent, Scope.close(port.scope, Exit.void));
          yield* host
            .connect({
              send: (sent) => runner.send(portId, sent),
              frames: Stream.fromQueue(port.inbox),
            })
            .pipe(Scope.provide(port.scope));
        }),
      ),
      Effect.forkScoped,
    );

    // A page that goes away takes its player with it.
    if (runner.disconnects !== undefined) {
      yield* Stream.fromQueue(runner.disconnects).pipe(
        Stream.runForEach((portId) =>
          Effect.suspend(() => {
            const port = ports.get(portId);
            ports.delete(portId);
            return port === undefined ? Effect.void : Scope.close(port.scope, Exit.void);
          }),
        ),
        Effect.forkScoped,
      );
    }

    // The handler only queues the frame and returns nothing, so there is nothing for it to require.
    yield* runner.run<void, never, never>((portId, frame) => {
      Queue.offerUnsafe(incoming, [portId, frame]);
    });
  });
