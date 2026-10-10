import * as Cloudflare from 'alchemy/Cloudflare';
import { Effect } from 'effect';
import { HttpServerRequest } from 'effect/http/HttpServerRequest';
import * as HttpServerResponse from 'effect/http/HttpServerResponse';
import Room from '#src/Room.ts';

// `/rooms/<id>` joins a room over a WebSocket; `/rooms/<id>/stats` reports how it is ticking.
const roomPath = /^\/rooms\/([\w-]{1,64})(\/stats)?$/;

export default class Server extends Cloudflare.Worker<Server>()(
  'NetSpike',
  { main: import.meta.url, dev: { port: 5390, strictPort: true } },
  Effect.gen(function* () {
    const rooms = yield* Room;

    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest;
        const match = roomPath.exec(new URL(request.url, 'http://server').pathname);
        if (match === null || match[1] === undefined) {
          return HttpServerResponse.text('Not found.', { status: 404 });
        }
        return yield* rooms.getByName(match[1]).fetch(request);
      }),
    };
  }),
) {}
