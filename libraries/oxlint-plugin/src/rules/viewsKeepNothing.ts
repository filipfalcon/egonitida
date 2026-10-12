import { type Node, type Rule, enclosingPartFunction, within } from '#src/ast.ts';

/**
 * A view's `draw` changes only its own object, from what the frame holds: what is drawn is a function of the state, so a past frame drawn again looks as it did. What a view must remember belongs in the state, as a local component.
 */

/** The variable `target` changes at its root: `x` in `x = 1` or `x.y.z = 1`; nothing for `this`. */
const rootOf = (target: Node): string | undefined =>
  target.type === 'Identifier'
    ? target.name
    : target.type === 'MemberExpression'
      ? rootOf(target.object)
      : undefined;

export const viewsKeepNothing: Rule = {
  meta: {
    type: 'problem',
    messages: {
      keeps:
        '`{{name}}` is kept from frame to frame by a view’s `draw`, so a frame drawn again would not look as it did. Change only the object the view built; keep what it must remember in the state, as a local component.',
    },
  },
  create: (context) => {
    const check = (node: Node, target: Node) => {
      const part = enclosingPartFunction(node);
      if (part === undefined || part.key !== 'draw') return;
      const name = rootOf(target);
      if (name === undefined) return;
      for (
        let scope: ReturnType<typeof context.sourceCode.getScope> | null =
          context.sourceCode.getScope(node);
        scope !== null;
        scope = scope.upper
      ) {
        const variable = scope.set.get(name);
        if (variable !== undefined) {
          if (!within(variable.scope.block, part.function_)) {
            context.report({ node, messageId: 'keeps', data: { name } });
          }
          return;
        }
      }
      context.report({ node, messageId: 'keeps', data: { name } });
    };
    return {
      AssignmentExpression: (node) => check(node, node.left),
      UpdateExpression: (node) => check(node, node.argument),
    };
  },
};
