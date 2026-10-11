import { Host } from '@lightocean/core';
import { Transport } from '@lightocean/core/internal';
import { type Cause, Effect, Exit, Option, Queue, Schema, Scope, Stream } from 'effect';

/**
 * A world hosted for the players who reach it across a network, as a Cloudflare Durable Object hosts one room: one host, joined by every socket that opens to it, one player each, and let go of when its socket closes. It knows nothing of Cloudflare: whatever runs it hands it each socket as it opens, the text each one receives, and when each closes, as a Durable Object's WebSocket handlers do.
 *
 * Time stands while no one is in it, so a room with no one in it takes no steps and keeps nothing awake. What it holds lives as long as whatever runs it: a Durable Object that sleeps forgets its world.
 */

/** The room's side of a socket: how it sends a player text. */
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

/** A room: the host of its world, and how a socket opens to it. */
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
    const state = { inside: 0 };
    yield* host.hold;

    /** Holds time while no one is in the room, and lets it run while someone is, by how many are in it now, whatever came between. */
    const settle = Effect.suspend(() => (state.inside === 0 ? host.hold : host.release));

    const open = (socket: Socket): Effect.Effect<Opened> =>
      Effect.gen(function* () {
        const scope = yield* Scope.fork(parent);
        const inbox = yield* Queue.unbounded<Transport.Frame, Cause.Done>();
        state.inside += 1;
        yield* settle;
        yield* host
          .connect({
            send: (frame) => socket.send(Transport.encodeFrame(frame)),
            frames: Stream.fromQueue(inbox),
          })
          .pipe(Scope.provide(scope));
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
            state.inside -= 1;
            return Effect.andThen(Scope.close(scope, Exit.void), settle);
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
