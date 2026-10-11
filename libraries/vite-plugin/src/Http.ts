import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';

/**
 * A Fetch handler on a development server: each request Node's server takes, as the Fetch `Request` it is, and the handler's `Response` sent back, so an Effect HTTP application serves at a path of the development server itself.
 */

/** A request, at the path it was sent to, whatever path the server mounted the handler at. */
const requestOf = (incoming: IncomingMessage & { readonly originalUrl?: string }): Request => {
  const method = incoming.method ?? 'GET';
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    for (const each of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      headers.append(name, each);
    }
  }
  const url = new URL(
    incoming.originalUrl ?? incoming.url ?? '/',
    `http://${incoming.headers.host ?? 'localhost'}`,
  );
  return method === 'GET' || method === 'HEAD'
    ? new Request(url, { method, headers })
    : new Request(url, {
        method,
        headers,
        body: Readable.toWeb(incoming),
        // A body read as it arrives, as Node's stream gives it.
        duplex: 'half',
      });
};

/** `handler` as a Node request listener, such as a development server's middleware. */
export const mounted =
  (handler: (request: Request) => Promise<Response>) =>
  (incoming: IncomingMessage, outgoing: ServerResponse): void => {
    void handler(requestOf(incoming)).then(
      (response) => {
        outgoing.statusCode = response.status;
        response.headers.forEach((value, name) => outgoing.setHeader(name, value));
        if (response.body === null) {
          outgoing.end();
        } else {
          Readable.fromWeb(response.body).pipe(outgoing);
        }
      },
      () => {
        outgoing.statusCode = 500;
        outgoing.end();
      },
    );
  };
