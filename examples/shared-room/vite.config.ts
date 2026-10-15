import stylex from '@stylexjs/unplugin';
import type { Plugin } from 'vite';
import { defineConfig } from 'vite-plus';

// Under `alchemy dev`, Alchemy's inline `server: { port: 0 }` resolves to Vite's 5173 default and outranks this file's `server.port`; a plugin `config` hook merges after it, so the port is pinned there instead.
const pinAlchemyDevPort = (port: number): Plugin => ({
  name: 'egonitida:pin-alchemy-dev-port',
  config: () =>
    process.env['ALCHEMY_CLOUDFLARE_VITE_INJECTED'] === '1'
      ? { server: { port, strictPort: true } }
      : {},
});

// StyleX compiles the page's styles; tests take its Rolldown entry, which compiles them the same without the development server's timer that would keep a test run from ending.
export default defineConfig({
  plugins: [
    process.env['VITEST'] === undefined ? stylex.vite() : stylex.rolldown(),
    pinAlchemyDevPort(5293),
  ],
  server: {
    // IPv4 loopback, explicitly: a dual-stack bind lets two inner dev servers under `alchemy dev` own the same port, one per address family.
    host: '127.0.0.1',
  },
});
