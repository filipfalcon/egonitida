import { describe, it } from '@effect/vitest';
import { RuleTester } from 'oxlint/plugins-dev';

// The rule tester runs its cases as the test runner's own.
RuleTester.describe = describe;
RuleTester.it = it;

/** A tester for TypeScript, as the rules are run on it. */
export const tester = new RuleTester({ languageOptions: { parserOptions: { lang: 'ts' } } });
