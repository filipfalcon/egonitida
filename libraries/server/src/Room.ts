import { Host } from '@nitida/core';
import { Transport } from '@nitida/core/internal';
import { type Cause, Effect, Exit, Option, Queue, Schema, Scope, Semaphore, Stream } from 'effect';

/**
 * A game hosted for the players who reach it across a network, as a Cloudflare Durable Object hosts one room: one host, joined by every socket that opens to it, one player each, and let go of when its socket closes. It knows nothing of Cloudflare: whatever runs it hands it each socket as it opens, the text each one receives, and when each closes, as a Durable Object's WebSocket methods do.
 *
 * Time stands while no one is in it, so a room with no one in it takes no steps and keeps nothing awake. What it holds lives as long as whatever runs it: a Durable Object that sleeps forgets its state.
 */

/** The room's side of a socket: how it sends a player text, at once, as a Durable Object's WebSocket does, since a socket opening is not cut short while it waits. */
export interface Socket {
  readonly send: (text: string) => Effect.Effect<void>;
}

/** A socket opened to a room: what to do with what it receives, and when it closes. */
export interface Opened {
  /** Takes text the socket received, a frame of the player's. */
  readonly received: (text: string) => Effect.Effect<void>;
  /** Lets go of the player, as their socket has closed; closing again changes nothing. */
  readonly closed: Effect.Effect<void>;
}

/** A room: the host of its game, and how a socket opens to it. */
export interface Room<Services = never> {
  readonly host: Host.Host<Services>;
  /** Joins a player through `socket`, until it closes or the room's scope does. */
  readonly open: (socket: Socket) => Effect.Effect<Opened>;
}

/** A room hosting a game as `options` say, until the scope closes, with no one in it yet. */
export const make = <Services = never>(
  options: Host.Options<Services>,
): Effect.Effect<Room<Services>, never, Scope.Scope | Services> =>
  Effect.gen(function* () {
    const parent = yield* Effect.scope;
    const host = yield* Host.make(options);
    const present = { inside: 0 };
    const turns = yield* Semaphore.make(1);
    yield* host.suspend;

    /** Suspends time while no one is in the room, and resumes it while someone is, by how many are in it now; one at a time, so what one finds is what it does, and the last to settle finds the room as it is. */
    const settle = turns.withPermit(
      Effect.suspend(() => (present.inside === 0 ? host.suspend : host.resume)),
    );

    const open = (socket: Socket): Effect.Effect<Opened> =>
      Effect.gen(function* () {
        const scope = yield* Scope.fork(parent);
        const inbox = yield* Queue.unbounded<Transport.Frame, Cause.Done>();
        present.inside += 1;
        yield* Effect.andThen(
          settle,
          host
            .connect({
              send: (frame) => socket.send(Transport.encodeFrame(frame)),
              frames: Stream.fromQueue(inbox),
            })
            .pipe(Scope.provide(scope)),
        ).pipe(
          // A player who could not be joined is not in the room.
          Effect.onError(() =>
            Effect.andThen(
              Effect.sync(() => {
                present.inside -= 1;
              }),
              Effect.andThen(Scope.close(scope, Exit.void), settle),
            ),
          ),
        );
        const left = { closed: false };
        return {
          received: (text: string) =>
            Option.match(Transport.decodeFrame(text), {
              // What is no frame is no one's to read.
              onNone: () => Effect.void,
              onSome: (frame) => Queue.offer(inbox, frame).pipe(Effect.asVoid),
            }),
          closed: Effect.suspend(() => {
            if (left.closed) {
              return Effect.void;
            }
            left.closed = true;
            present.inside -= 1;
            // Let go of and settled, even if what closed it is cut short.
            return Effect.uninterruptible(Effect.andThen(Scope.close(scope, Exit.void), settle));
          }),
        };
        // Counted in and joined, or neither: an open cut short leaves no one counted who is not there.
      }).pipe(Effect.uninterruptible);

    return { host, open };
  });

/** Where a Worker is asked for a room: a path under this, followed by the room's id. */
const ROOMS = '/rooms/';

/** A room's id: letters, digits, `_` and `-`, at most 64 of them, so a Worker refuses any other before a Durable Object is reached. */
export const Id = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[\w-]{1,64}$/)),
  Schema.brand('RoomId'),
);
export type Id = typeof Id.Type;

/** The room a Worker is asked for at `pathname`, if it names one. */
export const idOf = (pathname: string): Option.Option<Id> =>
  pathname.startsWith(ROOMS)
    ? Schema.decodeOption(Id)(pathname.slice(ROOMS.length))
    : Option.none();

/** Where a Worker is asked for the room `id`. */
export const pathOf = (id: Id): string => `${ROOMS}${id}`;
