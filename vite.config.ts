import { recommended } from '@effect/tsgo/oxlint-presets';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  fmt: {
    singleQuote: true,
  },
  lint: {
    extends: [recommended],
    rules: {
      // No type assertions: a value's type is proven where it is made, never claimed where it is used.
      'typescript/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
    },
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
