import { Build, Devtools } from '@lightocean/vite-plugin';
import { defineConfig } from 'vite-plus';

// In development, the server is the way to the horde's host for the tools on this machine, such as an MCP server.
export default defineConfig({
  plugins: [Devtools.plugin(), Build.plugin()],
  // A worker is built on its own, so the plugin naming the game's build is given to it too.
  worker: { plugins: () => [Build.plugin()] },
});
