#!/usr/bin/env node
import { NodeRuntime, NodeStdio } from '@effect/platform-node';
import { Layer } from 'effect';
import * as Server from '#src/Server.ts';

// The MCP server an agent starts: its tools over stdio, finding the development servers of the workspace it was started in, or of EGONITIDA_WORKSPACE if set.
const from = process.env['EGONITIDA_WORKSPACE'] ?? process.cwd();

Server.stdio(from).pipe(Layer.provide(NodeStdio.layer), Layer.launch, NodeRuntime.runMain);
