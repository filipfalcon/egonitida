#!/usr/bin/env node
import { NodeRuntime, NodeStdio } from '@effect/platform-node';
import { Layer } from 'effect';
import { McpProtocol, McpServer } from 'effect/ai';
import * as Tools from '#src/Tools.ts';

// The MCP server an agent starts: its tools over stdio, finding the development servers of the workspace it was started in, or of LIGHTOCEAN_WORKSPACE if set.
const from = process.env['LIGHTOCEAN_WORKSPACE'] ?? process.cwd();

McpServer.toolkit(Tools.toolkit).pipe(
  Layer.provide(Tools.toolkit.toLayer(Tools.handlers(from))),
  Layer.provide(
    McpServer.layerStdio({
      name: 'lightocean-devtools',
      version: '0.0.0',
      description:
        'A running LightOcean game, as its development server serves it: what it is made of, its world at any tick kept, its log, and time.',
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
