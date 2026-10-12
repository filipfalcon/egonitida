import { type Rule, calleeName, enclosingPart } from '#src/ast.ts';

/**
 * A system's or rule's `run` and a view's `draw` run every step or every frame, and a step must replay to the same state: they take randomness and time from their context, and do no Effect work, which belongs at the edges.
 */

/** Calls that return another value every time, wherever they run. */
const IMPURE = new Set(['Math.random', 'Date.now', 'performance.now']);
/** Modules whose work is Effect's, which a step or a frame does not do. */
const EFFECTFUL = new Set(['Effect', 'Stream', 'Schema']);

export const pureSteps: Rule = {
  meta: {
    type: 'problem',
    messages: {
      impure:
        '{{call}} in {{part}} returns another value on every run, so a replay would not reach the same state. Use the context: `context.random()` for randomness, `context.time` for time.',
      effect:
        '{{call}} in {{part}}, which runs every step or every frame: steps and frames are plain code. Do this work at the edge, in a command or in a view’s `acquire`.',
    },
  },
  create: (context) => ({
    CallExpression: (call) => {
      const name = calleeName(call);
      const part = enclosingPart(call);
      if (name === undefined || part === undefined) return;
      const [module] = name.split('.');
      if (IMPURE.has(name) || module === 'crypto') {
        context.report({ node: call, messageId: 'impure', data: { call: `\`${name}\``, part } });
      } else if (module !== undefined && name.includes('.') && EFFECTFUL.has(module)) {
        context.report({ node: call, messageId: 'effect', data: { call: `\`${name}\``, part } });
      }
    },
    NewExpression: (created) => {
      const part = enclosingPart(created);
      if (calleeName(created) === 'Date' && part !== undefined) {
        context.report({
          node: created,
          messageId: 'impure',
          data: { call: '`new Date()`', part },
        });
      }
    },
  }),
};
