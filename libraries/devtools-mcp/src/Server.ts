import { Context, Effect, Layer } from 'effect';
import { McpProtocol, McpServer } from 'effect/ai';
import { HttpRouter } from 'effect/http';
import * as Tools from '#src/Tools.ts';

/**
 * The MCP server a running game is reached by, as a development server serves it over HTTP: at its own path, and beside its relay, where the proxy an agent starts reaches it. Its tools find the development servers of the workspace `from` is in.
 */

/** Where a development server serves the MCP server over HTTP. */
export const PATH = '/__egonitida/mcp';

/** What the server says it is to a client. */
const INFO: Omit<Parameters<typeof McpServer.layerHttp>[0], 'path'> = {
  name: 'egonitida-devtools',
  version: '0.0.0',
  description:
    'A running EgoNitida game, as its development server serves it: what it is made of, its state at any tick kept, its log, time, playing it, and what its page shows.',
  protocols: [
    McpProtocol.v2025_11_25,
    McpProtocol.v2025_06_18,
    McpProtocol.v2025_03_26,
    McpProtocol.v2024_11_05,
  ],
};

/** Every tool; the screenshot tool is added on its own, since it answers with an image. */
export const tools = (from: string) =>
  Layer.mergeAll(
    McpServer.toolkit(Tools.toolkit).pipe(
      Layer.provide(Tools.toolkit.toLayer(Tools.implementations(from))),
    ),
    Layer.effectDiscard(
      Effect.gen(function* () {
        const server = yield* McpServer.McpServer;
        yield* server.addTool({
          tool: Tools.screenshotTool,
          annotations: Context.empty(),
          handle: Tools.screenshot(from),
        });
      }),
    ),
  );

/** The tools over HTTP at `PATH`, as a Fetch application a development server mounts; a request from a page in a browser is refused, so only tools on this machine reach it. */
export const web = (from: string) =>
  HttpRouter.toWebHandler(
    tools(from).pipe(Layer.provideMerge(McpServer.layerHttp({ ...INFO, path: PATH }))),
    { disableLogger: true },
  );
