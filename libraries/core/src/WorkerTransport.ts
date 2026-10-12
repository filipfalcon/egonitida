import { Effect, Exit, Option, Queue, Scope, Stream } from 'effect';
import * as Worker from 'effect/workers/Worker';
import type { WorkerError } from 'effect/workers/WorkerError';
import * as WorkerRunner from 'effect/workers/WorkerRunner';
import * as Host from '#src/Host.ts';
import type * as Transport from '#src/Transport.ts';

/**
 * A session between a page and a host running in a worker, for singleplayer: the same host a Durable Object runs, on the player's own machine, off the main thread. It is written against Effect's platform-neutral workers, so the platform decides what a worker is: a Web Worker, a shared worker, or a message port in a test.
 *
 * A worker has no notion of a connection opening, so the page says hello first, and a port's first frame is what joins it. The hello may carry what the page opens with, such as the state a host is to start from, which a worker that makes its host only then reads.
 */

/** The page's side: a connection to the host in the worker the platform spawns, opening with `opening`. */
export const connectOpening = (
  opening: string,
): Effect.Effect<
  Transport.Connection,
  WorkerError,
  Worker.WorkerPlatform | Worker.Spawner | Scope.Scope
> =>
  Effect.gen(function* () {
    const platform = yield* Worker.WorkerPlatform;
    const worker = yield* platform.spawn<Transport.Frame, Transport.Frame>(0);
    const inbox = yield* Queue.unbounded<Transport.Frame>();
    yield* worker.run((frame) => Queue.offer(inbox, frame)).pipe(Effect.forkScoped);
    const connection: Transport.Connection = {
      // A worker that can no longer take a frame is gone, which is a defect rather than a frame to lose.
      send: (frame) => worker.send(frame).pipe(Effect.orDie),
      frames: Stream.fromQueue(inbox),
    };
    yield* connection.send({ channel: 'reliable', payload: opening });
    return connection;
  });

/** The page's side: a connection to the host in the worker the platform spawns. */
export const connect: Effect.Effect<
  Transport.Connection,
  WorkerError,
  Worker.WorkerPlatform | Worker.Spawner | Scope.Scope
> = connectOpening('');

/** The worker's side: hosts a game for every page that connects, until the scope closes, running its commands with the `Services` it is given. */
export const serve = <Services = never>(
  options: Host.Options<Services>,
): Effect.Effect<void, WorkerError, WorkerRunner.WorkerRunnerPlatform | Scope.Scope | Services> =>
  Effect.flatMap(Host.make(options), serveHost);

/** The worker's side, for a host made beforehand, so the worker may also watch it, as development tools do: connects every page to `host`, until the scope closes. */
export const serveHost = (
  host: Host.Host,
): Effect.Effect<void, WorkerError, WorkerRunner.WorkerRunnerPlatform | Scope.Scope> =>
  serveOpened(() => Effect.succeed(host));

/** The worker's side, for a host made from what the first page opens with: makes it once, from the first page's opening, and connects every page to it, until the scope closes. */
export const serveOpened = <R>(
  make: (opening: string) => Effect.Effect<Host.Host, never, R | Scope.Scope>,
): Effect.Effect<void, WorkerError, WorkerRunner.WorkerRunnerPlatform | Scope.Scope | R> =>
  Effect.gen(function* () {
    const runner = yield* (yield* WorkerRunner.WorkerRunnerPlatform).start<
      Transport.Frame,
      Transport.Frame
    >();
    const parent = yield* Effect.scope;
    const made = { host: Option.none<Host.Host>() };
    /** The host, made from `opening` the first time a page opens. */
    const hostFor = (opening: string) =>
      Option.match(made.host, {
        onSome: Effect.succeed,
        onNone: () =>
          make(opening).pipe(
            Scope.provide(parent),
            Effect.tap((host) =>
              Effect.sync(() => {
                made.host = Option.some(host);
              }),
            ),
          ),
      });
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
          const host = yield* hostFor(frame.payload);
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

    // The listener only queues the frame and returns nothing, so there is nothing for it to require.
    yield* runner.run<void, never, never>((portId, frame) => {
      Queue.offerUnsafe(incoming, [portId, frame]);
    });
  });
