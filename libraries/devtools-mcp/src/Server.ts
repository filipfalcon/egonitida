import { Context, Effect, Layer } from 'effect';
import { McpProtocol, McpServer } from 'effect/ai';
import { HttpRouter } from 'effect/http';
import * as Tools from '#src/Tools.ts';

/**
 * The MCP server a running game is reached by, as an agent starts it over stdio, or as a development server serves it over HTTP at its own path. Both have the same tools, which find the development servers of the workspace `from` is in.
 */

/** Where a development server serves the MCP server over HTTP. */
export const PATH = '/__lightocean/mcp';

/** What the server says it is to a client. */
const INFO: Parameters<typeof McpServer.layerStdio>[0] = {
  name: 'lightocean-devtools',
  version: '0.0.0',
  description:
    'A running LightOcean game, as its development server serves it: what it is made of, its state at any tick kept, its log, time, playing it, and what its page shows.',
  protocols: [
    McpProtocol.v2025_11_25,
    McpProtocol.v2025_06_18,
    McpProtocol.v2025_03_26,
    McpProtocol.v2024_11_05,
  ],
};

/** Every tool, for whichever transport serves them; the screenshot tool is added on its own, since it answers with an image. */
export const tools = (from: string) =>
  Layer.mergeAll(
    McpServer.toolkit(Tools.toolkit).pipe(
      Layer.provide(Tools.toolkit.toLayer(Tools.handlers(from))),
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

/** The tools over stdio, as an agent starts the server. */
export const stdio = (from: string) => tools(from).pipe(Layer.provide(McpServer.layerStdio(INFO)));

/** The tools over HTTP at `PATH`, as a Fetch handler a development server mounts; a request from a page in a browser is refused, so only tools on this machine reach it. */
export const webHandler = (from: string) =>
  HttpRouter.toWebHandler(
    tools(from).pipe(Layer.provideMerge(McpServer.layerHttp({ ...INFO, path: PATH }))),
    { disableLogger: true },
  );
