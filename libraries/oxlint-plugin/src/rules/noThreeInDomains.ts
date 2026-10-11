import { type ImportDeclaration, type Rule, calleeName } from '#src/ast.ts';

/**
 * A domain's own module runs on the server too, in a worker or a Durable Object, where there is nothing to draw: Three.js belongs in its `.view` module. Tests are left alone, since a scene test tells a game and draws it in one file.
 */

const PARTS = new Set(['Domain.make', 'System.make', 'Rule.on']);

export const noThreeInDomains: Rule = {
  meta: {
    type: 'problem',
    messages: {
      three:
        'Three.js in a module that makes a domain, a system, or a rule, which the server runs too, where nothing is drawn. Move what draws into the domain’s `.view` module.',
    },
  },
  create: (context) => {
    // A test may tell a game and draw it in one file, as a scene test does.
    if (/\.test\.[cm]?[jt]sx?$/.test(context.filename)) {
      return {};
    }
    const imports: Array<ImportDeclaration> = [];
    const parts = { made: false };
    return {
      ImportDeclaration: (declaration) => {
        const from = declaration.source.value;
        if (from === 'three' || from.startsWith('three/')) {
          imports.push(declaration);
        }
      },
      CallExpression: (call) => {
        const name = calleeName(call);
        if (name !== undefined && PARTS.has(name)) {
          parts.made = true;
        }
      },
      'Program:exit': () => {
        if (!parts.made) return;
        for (const declaration of imports) {
          context.report({ node: declaration, messageId: 'three' });
        }
      },
    };
  },
};
