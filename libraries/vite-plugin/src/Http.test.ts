import { createServer } from 'node:http';
import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import * as Http from '#src/Http.ts';

describe('a Fetch application mounted on a development server', () => {
  it.live('takes each request as the Fetch Request it is, and sends back its Response', () =>
    Effect.gen(function* () {
      const handled = Http.mounted(
        async (request) =>
          new Response(
            `${request.method} ${new URL(request.url).pathname} ${await request.text()}`,
            {
              status: 201,
              headers: { 'x-seen': 'yes' },
            },
          ),
      );
      const server = createServer((request, response) => {
        handled(request, response);
      });
      const port = yield* Effect.promise(
        () =>
          new Promise<number>((resolve) => {
            server.listen(0, '127.0.0.1', () => {
              const address = server.address();
              resolve(typeof address === 'object' && address !== null ? address.port : 0);
            });
          }),
      );
      yield* Effect.addFinalizer(() => Effect.sync(() => server.close()));

      const response = yield* Effect.promise(() =>
        fetch(`http://127.0.0.1:${port}/__nitida/mcp`, { method: 'POST', body: 'hello' }),
      );

      expect(response.status).toBe(201);
      expect(response.headers.get('x-seen')).toBe('yes');
      expect(yield* Effect.promise(() => response.text())).toBe('POST /__nitida/mcp hello');
    }).pipe(Effect.scoped),
  );
});
