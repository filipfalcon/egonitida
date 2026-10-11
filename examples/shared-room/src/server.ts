import { Room } from '@lightocean/server/experimental';
import { World } from '@lightocean/core';
import * as Cloudflare from 'alchemy/Cloudflare';
import { Effect, Option, Scope } from 'effect';
import { HttpServerRequest } from 'effect/http/HttpServerRequest';
import * as HttpServerResponse from 'effect/http/HttpServerResponse';
import * as Walkers from '#src/walkers.ts';

// The room's side: a Worker that sends a page to its room, and a Durable Object for each room, which hosts its walkers for every page that opens a WebSocket to it. Under `alchemy dev` the Worker serves on a port of its own.

/** What a socket carries beside it while it is open, so the room knows whose it is when it wakes for a message. */
interface Attachment {
  readonly id: string;
}

/** One room of walkers, hosted for as long as the Durable Object is awake: a room no one is in stands still, and one that sleeps forgets where its walkers stood. */
export class SharedRoom extends Cloudflare.DurableObject<SharedRoom>()(
  'SharedRoom',
  // Alchemy's two phases: the outer Effect binds once, and the inner one it holds builds each instance.
  Effect.succeed(
    Effect.gen(function* () {
      // The room lives as long as this instance, past any one request.
      const lives = yield* Scope.make();
      const room = yield* Room.make({
        game: Walkers.game,
        world: Walkers.world,
        join: Walkers.join,
        leave: World.despawn,
        mayHold: false,
      }).pipe(Scope.provide(lives));
      const inside = new Map<string, Room.Opened>();

      /** Who `socket` is, as it said when it opened. */
      const idOf = (socket: Cloudflare.WebSocket) =>
        Option.flatMap(Option.fromNullishOr(socket.deserializeAttachment<Attachment>()), ({ id }) =>
          Option.fromNullishOr(inside.get(id)).pipe(Option.map((opened) => ({ id, opened }))),
        );

      return {
        fetch: Effect.gen(function* () {
          const [response, socket] = yield* Cloudflare.upgrade();
          const id = crypto.randomUUID();
          socket.serializeAttachment({ id } satisfies Attachment);
          inside.set(id, yield* room.open({ send: (text) => socket.send(text) }));
          return response;
        }),
        webSocketMessage: (socket: Cloudflare.WebSocket, message: string | ArrayBuffer) =>
          Option.match(idOf(socket), {
            // A socket the room does not know opened before it last slept, and its player is gone with what it forgot.
            onNone: () => socket.close(1012, 'The room started over.'),
            onSome: ({ opened }) =>
              typeof message === 'string' ? opened.received(message) : Effect.void,
          }),
        webSocketClose: (socket: Cloudflare.WebSocket, code: number) =>
          Effect.andThen(
            Option.match(idOf(socket), {
              onNone: () => Effect.void,
              onSome: ({ id, opened }) => {
                inside.delete(id);
                return opened.closed;
              },
            }),
            socket.close(code, 'Left the room.'),
          ),
      };
    }),
  ),
) {}

/** The Worker: sends `/rooms/<id>` to that room's Durable Object, and refuses any other address before a room is reached. */
export default class Rooms extends Cloudflare.Worker<Rooms>()(
  'SharedRooms',
  { main: import.meta.url, dev: { port: 5590, strictPort: true } },
  Effect.gen(function* () {
    const rooms = yield* SharedRoom;

    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest;
        return yield* Option.match(Room.idOf(new URL(request.url, 'http://rooms').pathname), {
          onNone: () => Effect.succeed(HttpServerResponse.text('No such room.', { status: 404 })),
          onSome: (id) => rooms.getByName(id).fetch(request),
        });
      }),
    };
  }),
) {}
