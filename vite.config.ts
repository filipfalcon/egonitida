import { recommended } from '@effect/tsgo/oxlint-presets';
import egonitida from '@egonitida/oxlint-plugin/recommended.json' with { type: 'json' };
import { defineConfig } from 'vite-plus';

export default defineConfig({
  fmt: {
    singleQuote: true,
    // Lean writes what it proved exactly as `lake exe export --check` reads it back.
    ignorePatterns: ['verification/declarations.json'],
  },
  lint: {
    // The engine's own conventions come after Effect's, and hold for the engine as for any game on it.
    extends: [recommended, egonitida],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  staged: {
    '*': 'vp check --fix',
  },
  test: {
    projects: ['applications/*', 'examples/*', 'libraries/*'],
  },
});
