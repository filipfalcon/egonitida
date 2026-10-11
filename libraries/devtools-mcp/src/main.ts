#!/usr/bin/env node
import { NodeRuntime, NodeStdio } from '@effect/platform-node';
import { Context, Effect, Layer } from 'effect';
import { McpProtocol, McpServer } from 'effect/ai';
import * as Tools from '#src/Tools.ts';

// The MCP server an agent starts: its tools over stdio, finding the development servers of the workspace it was started in, or of LIGHTOCEAN_WORKSPACE if set.
const from = process.env['LIGHTOCEAN_WORKSPACE'] ?? process.cwd();

/** The screenshot tool, registered on its own, since it answers with an image. */
const screenshotting = Layer.effectDiscard(
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    yield* server.addTool({
      tool: Tools.screenshotTool,
      annotations: Context.empty(),
      handle: Tools.screenshot(from),
    });
  }),
);

Layer.mergeAll(
  McpServer.toolkit(Tools.toolkit).pipe(Layer.provide(Tools.toolkit.toLayer(Tools.handlers(from)))),
  screenshotting,
).pipe(
  Layer.provide(
    McpServer.layerStdio({
      name: 'lightocean-devtools',
      version: '0.0.0',
      description:
        'A running LightOcean game, as its development server serves it: what it is made of, its world at any tick kept, its log, time, playing it, and what its page shows.',
      protocols: [
        McpProtocol.v2025_11_25,
        McpProtocol.v2025_06_18,
        McpProtocol.v2025_03_26,
        McpProtocol.v2024_11_05,
      ],
    }),
  ),
  Layer.provide(NodeStdio.layer),
  Layer.launch,
  NodeRuntime.runMain,
);
