import { recommended } from '@effect/tsgo/oxlint-presets';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  fmt: {
    singleQuote: true,
  },
  lint: {
    extends: [recommended],
    rules: {
      // Types are proven where values are made, never claimed where they are used: no `any`, no type assertions, and no non-null assertions, which are the same claim spelled `!`.
      'typescript/no-explicit-any': 'error',
      'typescript/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
      'typescript/no-non-null-assertion': 'error',
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
    projects: ['applications/*', 'examples/*', 'libraries/*'],
  },
});
