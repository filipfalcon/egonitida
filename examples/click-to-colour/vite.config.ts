import { Devtools } from '@lightocean/vite-plugin';
import { defineConfig } from 'vite-plus';

// In development, the server is the way to the cubes' host for the tools on this machine, such as an MCP server.
export default defineConfig({ plugins: [Devtools.plugin()] });
