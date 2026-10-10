import { recommended } from '@effect/tsgo/oxlint-presets';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  fmt: {
    singleQuote: true,
  },
  lint: {
    extends: [recommended],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  staged: {
    '*': 'vp check --fix',
  },
  test: {
    projects: ['applications/*', 'libraries/*'],
  },
});
