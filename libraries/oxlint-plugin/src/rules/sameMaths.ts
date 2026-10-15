import { type CallExpression, type Node, type Rule, calleeName } from '#src/ast.ts';

/**
 * A step must come to the same state on every host that steps it: the server, each client predicting it, and a replay in another browser. ECMAScript leaves `Math.sin`, `Math.atan2`, `Math.hypot`, `**`, and their like approximate, each engine to its own last bits, so a module that makes a domain, a system, or a rule takes its maths from `Maths`, which every engine works out alike, and multiplies rather than raising to a power. What is exact everywhere, such as `Math.sqrt`, `Math.floor`, and `Math.abs`, stays. Tests are left alone, since they step the game on one engine and draw it too.
 */

const PARTS = new Set(['Domain.make', 'System.make', 'Rule.on']);

/** `Math`'s functions that each engine works out to its own last bits. */
const APPROXIMATE = new Set(
  [
    'sin',
    'cos',
    'tan',
    'asin',
    'acos',
    'atan',
    'atan2',
    'sinh',
    'cosh',
    'tanh',
    'asinh',
    'acosh',
    'atanh',
    'hypot',
    'exp',
    'expm1',
    'log',
    'log1p',
    'log2',
    'log10',
    'pow',
    'cbrt',
  ].map((name) => `Math.${name}`),
);

/** The functions `Maths` has in place of `Math`'s. */
const IN_MATHS = new Set(['sin', 'cos', 'asin', 'acos', 'atan', 'atan2', 'hypot']);

export const sameMaths: Rule = {
  meta: {
    type: 'problem',
    messages: {
      approximate:
        '{{call}} is approximate: each JavaScript engine works it out to its own last bits, so the server, a client predicting it, and a replay in another browser could step the same state apart. {{instead}}',
      power:
        '`**` is approximate: each JavaScript engine works it out to its own last bits, so the server, a client predicting it, and a replay in another browser could step the same state apart. Multiply instead.',
    },
  },
  create: (context) => {
    if (/\.test\.[cm]?[jt]sx?$/.test(context.filename)) {
      return {};
    }
    const calls: Array<readonly [CallExpression, string]> = [];
    const powers: Array<Node> = [];
    const parts = { made: false };
    return {
      CallExpression: (call) => {
        const name = calleeName(call);
        if (name === undefined) return;
        if (PARTS.has(name)) {
          parts.made = true;
        }
        if (APPROXIMATE.has(name)) {
          calls.push([call, name]);
        }
      },
      BinaryExpression: (expression) => {
        if (expression.operator === '**') {
          powers.push(expression);
        }
      },
      AssignmentExpression: (expression) => {
        if (expression.operator === '**=') {
          powers.push(expression);
        }
      },
      'Program:exit': () => {
        if (!parts.made) return;
        for (const [call, name] of calls) {
          const [, function_ = ''] = name.split('.');
          context.report({
            node: call,
            messageId: 'approximate',
            data: {
              call: `\`${name}\``,
              instead: IN_MATHS.has(function_)
                ? `Use \`Maths.${function_}\` from \`@lightocean/core\`, which every engine works out alike.`
                : 'Work it out with `Maths`, from `@lightocean/core`, and exact arithmetic, which every engine works out alike.',
            },
          });
        }
        for (const power of powers) {
          context.report({ node: power, messageId: 'power' });
        }
      },
    };
  },
};
