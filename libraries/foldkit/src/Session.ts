import { BrowserWorker } from '@effect/platform-browser';
import { Drawing } from '@egonitida/client';
import { Client, type Game, WorkerTransport } from '@egonitida/core';
import { Duration, Effect, Option, Schema, type Scope, Stream } from 'effect';
import type { WorkerError } from 'effect/workers/WorkerError';
import type { ManagedResource } from 'foldkit';

/**
 * A session: one player's connection to a hosted game, from joining to leaving. An application built on Foldkit opens one by starting a worker that hosts the game, joins it as one player, and holds the session as a Foldkit Managed Resource for as long as the application's Model wants it. Foldkit keeps the DOM and reads off the game's state only what it shows; the game is played through the session's client, by the Commands the application's `update` returns.
 */

/** A session joined: the client that plays the game, and the drawing that brings its frames to the display's pace. */
export interface Joined {
  readonly client: Client.Client;
  readonly drawing: Drawing.Drawing;
}

/** How long a drawing keeps the states it was sent, in seconds, unless told. */
const KEEP_SECONDS = 1;

/** Joins `game`, hosted in the worker `worker` starts, until the scope closes; opening with `opening`, if the worker makes its host from what a page opens with. */
export const join = (
  game: Game.Game,
  worker: () => Worker | MessagePort,
  options: {
    readonly keepSeconds?: number | undefined;
    readonly opening?: string | undefined;
  } = {},
): Effect.Effect<Joined, WorkerError, Scope.Scope> =>
  Effect.gen(function* () {
    const connection = yield* WorkerTransport.connectOpening(options.opening ?? '');
    const client = yield* Client.connect(connection, { game });
    const drawing = yield* Drawing.make(client, {
      keepSeconds: options.keepSeconds ?? KEEP_SECONDS,
    });
    return { client, drawing };
  }).pipe(Effect.provide(BrowserWorker.layer(worker)));

/** What a session's Managed Resource asks of the Model: nothing but whether it is wanted. */
export const Requirements = Schema.Option(Schema.Null);

/**
 * A session as a Foldkit Managed Resource, for `entry(Session.Requirements, Session.managed(…))`: joined while `joins` says so of the Model, and left once it does not; joining, leaving, and failing to join each said in a Message of the application's.
 */
export const managed = <Model, Message, Service>(options: {
  readonly resource: ManagedResource.ManagedResource<Joined, Service>;
  readonly game: Game.Game;
  readonly worker: () => Worker | MessagePort;
  readonly keepSeconds?: number | undefined;
  readonly joins: (model: Model) => boolean;
  readonly onJoined: (joined: Joined) => Message;
  readonly onLeft: () => Message;
  readonly onFailed: (reason: string) => Message;
}) => ({
  resource: options.resource,
  modelToMaybeRequirements: (model: Model): Option.Option<null> =>
    options.joins(model) ? Option.some(null) : Option.none(),
  acquire: () => join(options.game, options.worker, { keepSeconds: options.keepSeconds }),
  // The scope the session was joined in lets go of it.
  release: () => Effect.void,
  onAcquired: options.onJoined,
  onReleased: options.onLeft,
  onAcquireError: (error: unknown) =>
    options.onFailed(error instanceof Error ? error.message : String(error)),
});

/** How long a page that believes its session is not joined waits before it looks again whether it is: at first briefly, then twice as long each time, up to the longest. */
const FIRST_WAIT = Duration.millis(50);
const LONGEST_WAIT = Duration.seconds(1);

/**
 * The moment a session is joined, as a Foldkit Subscription's Stream, for a Model that says it is not: `onJoined` once `resource` holds the session, looked for until it does. Looked for briefly at first, and less often the longer it is not joined. A session may be joined before a page hears that it is not, as when a stage finds it not joined a moment before it is, and the session joined says so only once; this says it again, so the page never waits for a session it has.
 */
export const whenJoined = <Message, Service>(options: {
  readonly resource: ManagedResource.ManagedResource<Joined, Service>;
  readonly onJoined: () => Message;
}): Stream.Stream<Message, never, Service> =>
  Stream.fromEffect(Effect.map(lookedFor(options.resource, FIRST_WAIT), () => options.onJoined()));

/** The session `resource` holds, looked for again after `wait` while it holds none, and each time after waiting longer, as a session that has not joined soon may not join for a while. */
const lookedFor = <Service>(
  resource: ManagedResource.ManagedResource<Joined, Service>,
  wait: Duration.Duration,
): Effect.Effect<Joined, never, Service> =>
  resource.get.pipe(
    Effect.catch(() =>
      Effect.andThen(
        Effect.sleep(wait),
        Effect.suspend(() =>
          lookedFor(resource, Duration.min(Duration.times(wait, 2), LONGEST_WAIT)),
        ),
      ),
    ),
  );

/** What a session opened by the Model asks of it: what to open with, while it is wanted. */
export const Opening = Schema.Option(Schema.String);

/**
 * A session as a Foldkit Managed Resource opened with what the Model holds, for `entry(Session.Opening, Session.opened(…))`: joined while `opens` gives what to open the worker with, such as the state its host is to start from; opened anew when that changes, and left once it gives nothing.
 */
export const opened = <Model, Message, Service>(options: {
  readonly resource: ManagedResource.ManagedResource<Joined, Service>;
  readonly game: Game.Game;
  readonly worker: () => Worker | MessagePort;
  readonly keepSeconds?: number | undefined;
  readonly opens: (model: Model) => Option.Option<string>;
  readonly onJoined: (joined: Joined) => Message;
  readonly onLeft: () => Message;
  readonly onFailed: (reason: string) => Message;
}) => ({
  resource: options.resource,
  modelToMaybeRequirements: options.opens,
  acquire: (opening: string) =>
    join(options.game, options.worker, { keepSeconds: options.keepSeconds, opening }),
  // The scope the session was joined in lets go of it.
  release: () => Effect.void,
  onAcquired: options.onJoined,
  onReleased: options.onLeft,
  onAcquireError: (error: unknown) =>
    options.onFailed(error instanceof Error ? error.message : String(error)),
});
