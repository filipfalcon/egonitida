import { BrowserWorker } from '@effect/platform-browser';
import { Drawing } from '@lightocean/client';
import { Client, type Game, WorkerTransport } from '@lightocean/core';
import { Effect, Option, Schema, type Scope, Stream } from 'effect';
import type { WorkerError } from 'effect/workers/WorkerError';
import type { ManagedResource } from 'foldkit';

/**
 * A world an application built on Foldkit shows: hosted in a worker the page starts, joined as one player, and held as a Foldkit Managed Resource, for as long as the application's Model wants it. Foldkit keeps the DOM, and reads of the world only what it shows; the world is played through its client, by the Commands the application's `update` returns.
 */

/** A world joined: the client that plays it, and the drawing that brings its frames to the display's pace. */
export interface Joined {
  readonly client: Client.Client;
  readonly drawing: Drawing.Drawing;
}

/** How long a drawing keeps the worlds it was sent, in seconds, unless told. */
const KEEP_SECONDS = 1;

/** Joins the world of `game`, hosted in the worker `worker` starts, until the scope closes; opening with `opening`, if the worker makes its host from what a page opens with. */
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

/** What a world's Managed Resource asks of the Model: nothing but whether it is wanted. */
export const Requirements = Schema.Option(Schema.Null);

/**
 * A world as a Foldkit Managed Resource, for `entry(World.Requirements, World.managed(…))`: joined while `joins` says so of the Model, and left once it does not; joining, leaving, and failing to join each said in a Message of the application's.
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
  // The scope the world was joined in lets go of it.
  release: () => Effect.void,
  onAcquired: options.onJoined,
  onReleased: options.onLeft,
  onAcquireError: (error: unknown) =>
    options.onFailed(error instanceof Error ? error.message : String(error)),
});

/** How often a page that believes its world is not joined looks whether it is. */
const LOOKED_EVERY = '50 millis';

/**
 * The moment a world is joined, as a Foldkit Subscription's Stream, for a Model that says it is not: `onJoined` once `resource` holds the world, looked for until it does. A world may be joined before a page hears that it is not, as when a stage finds it not joined a moment before it is, and the world joined says so only once; this says it again, so the page never waits for a world it has.
 */
export const whenJoined = <Message, Service>(options: {
  readonly resource: ManagedResource.ManagedResource<Joined, Service>;
  readonly onJoined: () => Message;
}): Stream.Stream<Message, never, Service> =>
  Stream.fromEffect(
    options.resource.get.pipe(
      // Not joined yet: looked for again after a while.
      Effect.tapError(() => Effect.sleep(LOOKED_EVERY)),
      Effect.eventually,
      Effect.map(() => options.onJoined()),
    ),
  );

/** What a world opened by the Model asks of it: what to open with, while it is wanted. */
export const Opening = Schema.Option(Schema.String);

/**
 * A world as a Foldkit Managed Resource opened with what the Model holds, for `entry(World.Opening, World.opened(…))`: joined while `opens` gives what to open the worker with, such as the world its host is to start from; opened anew when that changes, and left once it gives nothing.
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
  // The scope the world was joined in lets go of it.
  release: () => Effect.void,
  onAcquired: options.onJoined,
  onReleased: options.onLeft,
  onAcquireError: (error: unknown) =>
    options.onFailed(error instanceof Error ? error.message : String(error)),
});
