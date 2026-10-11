import { Devtools } from '@lightocean/vite-plugin';
import stylex from '@stylexjs/unplugin';
import { defineConfig } from 'vite-plus';

// In development, the server is the way to the game's host for the tools on this machine, such as an MCP server. StyleX compiles the page's styles; tests take its Rolldown entry, which compiles them the same without the development server's timer that would keep a test run from ending.
export default defineConfig({
  plugins: [
    process.env['VITEST'] === undefined ? stylex.vite() : stylex.rolldown(),
    Devtools.plugin(),
  ],
});
