import { PARTS, type Rule, calleeName, enclosingPart } from '#src/ast.ts';

/**
 * A system's or rule's `run` and a view's `draw` run every step or every frame, and a step must replay to the same state: they take randomness and time from their context, and do no Effect work, which belongs at the edges. What a view builds as an entity comes is drawn from the frame too, so a replay draws it the same, though its `acquire` may do Effect work.
 */

/** The parts that take randomness and time from their context: those run every step or every frame, and what builds a view's object. */
const DRAWN: ReadonlyArray<readonly [callee: string, property: string]> = [
  ...PARTS,
  ['View.each', 'acquire'],
  ['View.whole', 'acquire'],
];

/** Calls that return another value every time, wherever they run. */
const IMPURE = new Set(['Math.random', 'Date.now', 'performance.now']);
/** Modules whose work is Effect's, which a step or a frame does not do. */
const EFFECTFUL = new Set(['Effect', 'Stream', 'Schema']);

/** Where `part` takes randomness and time from instead: a view from its frame, a step from its context. */
const insteadIn = (part: string) =>
  part.startsWith('View.')
    ? 'Use the frame: `frame.random(entity, part)` for randomness, `frame.tick` for time.'
    : 'Use the context: `context.random()` for randomness, `context.time` for time.';

export const pureSteps: Rule = {
  meta: {
    type: 'problem',
    messages: {
      impure:
        '{{call}} in {{part}} returns another value on every run, so a replay would not reach the same state. {{instead}}',
      effect:
        '{{call}} in {{part}}, which runs every step or every frame: steps and frames are plain code. Do this work at the edge, in a command or in a view’s `acquire`.',
    },
  },
  create: (context) => ({
    CallExpression: (call) => {
      const name = calleeName(call);
      if (name === undefined) return;
      const [module] = name.split('.');
      const drawn = enclosingPart(call, DRAWN);
      if (drawn !== undefined && (IMPURE.has(name) || module === 'crypto')) {
        context.report({
          node: call,
          messageId: 'impure',
          data: { call: `\`${name}\``, part: drawn, instead: insteadIn(drawn) },
        });
        return;
      }
      const part = enclosingPart(call);
      if (
        part !== undefined &&
        module !== undefined &&
        name.includes('.') &&
        EFFECTFUL.has(module)
      ) {
        context.report({ node: call, messageId: 'effect', data: { call: `\`${name}\``, part } });
      }
    },
    NewExpression: (created) => {
      const part = enclosingPart(created, DRAWN);
      if (calleeName(created) === 'Date' && part !== undefined) {
        context.report({
          node: created,
          messageId: 'impure',
          data: { call: '`new Date()`', part, instead: insteadIn(part) },
        });
      }
    },
  }),
};
