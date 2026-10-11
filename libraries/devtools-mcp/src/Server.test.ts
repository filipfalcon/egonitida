import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import * as Server from '#src/Server.ts';

/** A JSON-RPC request to the server's endpoint, as an MCP client over HTTP posts it. */
const post = (body: object, session?: string) =>
  new Request(`http://127.0.0.1${Server.PATH}`, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'mcp-protocol-version': '2025-06-18',
      ...(session === undefined ? {} : { 'mcp-session-id': session }),
    },
    body: JSON.stringify({ jsonrpc: '2.0', ...body }),
  });

describe('the MCP server over HTTP', () => {
  it.live('answers an MCP client at its path, with the same tools as over stdio', () =>
    Effect.gen(function* () {
      const { handler, dispose } = Server.webHandler(process.cwd());
      yield* Effect.addFinalizer(() => Effect.promise(dispose));

      const initialized = yield* Effect.promise(() =>
        handler(
          post({
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2025-06-18',
              capabilities: {},
              clientInfo: { name: 'test', version: '0' },
            },
          }),
        ),
      );
      const session = initialized.headers.get('mcp-session-id') ?? undefined;
      const greeting = yield* Effect.promise(() => initialized.text());
      const listed = yield* Effect.promise(() =>
        handler(post({ id: 2, method: 'tools/list', params: {} }, session)).then((response) =>
          response.text(),
        ),
      );

      expect(greeting).toContain('lightocean-devtools');
      expect(listed).toContain('lightocean_hosts');
      expect(listed).toContain('lightocean_screenshot');
    }).pipe(Effect.scoped),
  );
});
