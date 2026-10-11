import { foldkit } from '@foldkit/vite-plugin';
import { Devtools } from '@lightocean/vite-plugin';
import type { Plugin } from 'vite';
import { defineConfig } from 'vite-plus';

// Under `alchemy dev`, Alchemy's inline `server: { port: 0 }` resolves to Vite's 5173 default and outranks this file's `server.port`; a plugin `config` hook merges after it, so the port is pinned there instead.
const pinAlchemyDevPort = (port: number): Plugin => ({
  name: 'lightocean:pin-alchemy-dev-port',
  config: () =>
    process.env['ALCHEMY_CLOUDFLARE_VITE_INJECTED'] === '1'
      ? { server: { port, strictPort: true } }
      : {},
});

export default defineConfig({
  // In development, the server is also the way to the world's host for the tools on this machine, such as an MCP server.
  plugins: [...foldkit(), Devtools.plugin(), pinAlchemyDevPort(5290)],
  optimizeDeps: {
    entries: ['src/entry.ts'],
    // The plugin's per-module transform injects the foldkit/brand import, so the optimizer's crawl never sees it; left undeclared, a cold cache re-optimizes and reloads the page on first load.
    include: ['foldkit/brand'],
  },
  server: {
    // IPv4 loopback, explicitly: a dual-stack bind lets two inner dev servers under `alchemy dev` own the same port, one per address family.
    host: '127.0.0.1',
  },
  test: {
    name: 'playground',
    include: ['src/**/*.test.ts'],
  },
});
