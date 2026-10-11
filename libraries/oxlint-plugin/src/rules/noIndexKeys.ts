import { type Node, type Rule, contains } from '#src/ast.ts';

/**
 * A node drawn for one of many is keyed by an id the state gives it, never by where it stands in a list: keyed by position, whatever was drawn for one is drawn for another once the list changes.
 */

/** The name of the index `node` sits in a `.map` callback for, if it has one. */
const mappedIndex = (node: Node): string | undefined => {
  for (let at: Node | null = node; at !== null; at = at.parent) {
    if (at.type !== 'ArrowFunctionExpression' && at.type !== 'FunctionExpression') continue;
    const call: Node | null = at.parent;
    const index = at.params[1];
    if (
      call?.type === 'CallExpression' &&
      call.arguments[0] === at &&
      call.callee.type === 'MemberExpression' &&
      call.callee.property.type === 'Identifier' &&
      call.callee.property.name === 'map' &&
      index?.type === 'Identifier'
    ) {
      return index.name;
    }
  }
  return undefined;
};

export const noIndexKeys: Rule = {
  meta: {
    type: 'problem',
    messages: {
      index:
        'A `key` made from `{{index}}`, a position in a list: once the list changes, what was drawn for one is drawn for another. Key it by an id the state gives it.',
    },
  },
  create: (context) => ({
    Property: (property) => {
      if (
        property.type !== 'Property' ||
        property.key.type !== 'Identifier' ||
        property.key.name !== 'key'
      ) {
        return;
      }
      const index = mappedIndex(property);
      if (
        index !== undefined &&
        contains(property.value, (node) => node.type === 'Identifier' && node.name === index)
      ) {
        context.report({ node: property, messageId: 'index', data: { index } });
      }
    },
  }),
};
