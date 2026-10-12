import { type CallExpression, type Node, type Rule, calleeName } from '#src/ast.ts';

/**
 * A component's values say absence with `Option`, and modes with tagged unions, never with a field that may be null or absent.
 */

const NULLABLE = new Set([
  'Schema.NullOr',
  'Schema.UndefinedOr',
  'Schema.NullishOr',
  'Schema.optional',
  'Schema.optionalKey',
]);

/** Whether `node` sits in the schema given to `Component.make`. */
const inComponentSchema = (node: Node): boolean => {
  for (let at: Node | null = node; at !== null; at = at.parent) {
    const parent: Node | null = at.parent;
    if (
      parent?.type === 'CallExpression' &&
      calleeName(parent) === 'Component.make' &&
      parent.arguments[1] === at
    ) {
      return true;
    }
  }
  return false;
};

export const noNullableComponents: Rule = {
  meta: {
    type: 'problem',
    messages: {
      nullable:
        '{{call}} in a component’s schema: a component’s values say absence with `Schema.Option`, and modes with a tagged union, so no value of it can be half there.',
    },
  },
  create: (context) => ({
    CallExpression: (call: CallExpression) => {
      const name = calleeName(call);
      if (name !== undefined && NULLABLE.has(name) && inComponentSchema(call)) {
        context.report({ node: call, messageId: 'nullable', data: { call: `\`${name}\`` } });
      }
    },
  }),
};
