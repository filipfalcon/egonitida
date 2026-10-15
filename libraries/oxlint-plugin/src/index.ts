import { noIndexKeys } from '#src/rules/noIndexKeys.ts';
import { noNullableComponents } from '#src/rules/noNullableComponents.ts';
import { noThreeInDomains } from '#src/rules/noThreeInDomains.ts';
import { pureSteps } from '#src/rules/pureSteps.ts';
import { redactedCommandSecrets } from '#src/rules/redactedCommandSecrets.ts';
import { sameMaths } from '#src/rules/sameMaths.ts';
import { viewsKeepNothing } from '#src/rules/viewsKeepNothing.ts';

/**
 * LightOcean's conventions that a type cannot hold, as Oxlint rules: one rule each, each telling what to do instead. What a type can hold, such as who may write a component, is a type, and needs no rule.
 */
export default {
  meta: { name: 'lightocean' },
  rules: {
    'pure-steps': pureSteps,
    'no-nullable-components': noNullableComponents,
    'views-keep-nothing': viewsKeepNothing,
    'no-index-keys': noIndexKeys,
    'no-three-in-domains': noThreeInDomains,
    'redacted-command-secrets': redactedCommandSecrets,
    'same-maths': sameMaths,
  },
};
