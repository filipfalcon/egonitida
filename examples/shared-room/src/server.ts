import { Room } from '@egonitida/server/experimental';
import { State } from '@egonitida/core';
import * as Cloudflare from 'alchemy/Cloudflare';
import { Effect, Option, Schema, Scope } from 'effect';
import { HttpServerRequest } from 'effect/http/HttpServerRequest';
import * as HttpServerResponse from 'effect/http/HttpServerResponse';
import * as Walkers from '#src/walkers.ts';

// The room's side: a Worker that sends a page to its room, and a Durable Object for each room, which hosts its walkers for every page that opens a WebSocket to it. Under `alchemy dev` the Worker serves on a port of its own.

/** What a socket carries beside it while it is open, so the room knows whose it is when it wakes for a message. */
const Attachment = Schema.Struct({ id: Schema.String });

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
        state: Walkers.state,
        join: Walkers.join,
        leave: State.despawn,
        maySuspend: false,
      }).pipe(Scope.provide(lives));
      const inside = new Map<string, Room.Opened>();

      /** Who `socket` is, as it said when it opened, if the room still knows. */
      const whoIs = (socket: Cloudflare.WebSocket) =>
        socket.getAttachment(Attachment).pipe(
          Effect.option,
          Effect.map((attached) =>
            Option.flatMap(attached, ({ id }) =>
              Option.map(Option.fromNullishOr(inside.get(id)), (opened) => ({ id, opened })),
            ),
          ),
        );

      /** Lets go of whoever `socket` was, as it has closed or broken. */
      const letGo = (socket: Cloudflare.WebSocket) =>
        Effect.flatMap(whoIs(socket), (who) =>
          Option.match(who, {
            onNone: () => Effect.void,
            onSome: ({ id, opened }) => {
              inside.delete(id);
              return opened.closed;
            },
          }),
        );

      return {
        fetch: Effect.gen(function* () {
          const [response, socket] = yield* Cloudflare.upgrade();
          const id = crypto.randomUUID();
          yield* socket.setAttachment(Attachment, { id }).pipe(Effect.orDie);
          inside.set(id, yield* room.open({ send: (text) => socket.send(text) }));
          return response;
        }),
        webSocketMessage: (socket: Cloudflare.WebSocket, message: string | ArrayBuffer) =>
          Effect.flatMap(whoIs(socket), (who) =>
            Option.match(who, {
              // A socket the room does not know opened before it last slept, and its player is gone with what it forgot.
              onNone: () => socket.close(1012, 'The room started over.'),
              onSome: ({ opened }) =>
                typeof message === 'string' ? opened.received(message) : Effect.void,
            }),
          ),
        // The code a socket closed with may be one only the platform may send, such as 1006 for a page that dropped, so the room closes with its own.
        webSocketClose: (socket: Cloudflare.WebSocket) =>
          Effect.andThen(letGo(socket), socket.close(1000, 'Left the room.')),
        webSocketError: (socket: Cloudflare.WebSocket) => letGo(socket),
      };
    }),
  ),
) {}

/** The Worker: sends a WebSocket to `/rooms/<id>` on to that room's Durable Object, and refuses anything else before a room is reached. Any page may open any room: an example's rooms are open to all. */
export default class Rooms extends Cloudflare.Worker<Rooms>()(
  'SharedRooms',
  { main: import.meta.url, dev: { port: 5590, strictPort: true } },
  Effect.gen(function* () {
    const rooms = yield* SharedRoom;

    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest;
        // A room is opened by a WebSocket alone, so a plain request, such as a link's preview, never counts as a player.
        if (request.headers['upgrade']?.toLowerCase() !== 'websocket') {
          return HttpServerResponse.text('A room is opened by a WebSocket.', {
            status: 426,
            headers: { upgrade: 'websocket' },
          });
        }
        return yield* Option.match(Room.idOf(new URL(request.url, 'http://rooms').pathname), {
          onNone: () => Effect.succeed(HttpServerResponse.text('No such room.', { status: 404 })),
          onSome: (id) => rooms.getByName(id).fetch(request),
        });
      }),
    };
  }),
) {}
