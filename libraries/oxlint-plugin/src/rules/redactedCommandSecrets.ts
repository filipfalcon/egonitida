import { type Rule, calleeName } from '#src/ast.ts';

/**
 * A command's arguments are recorded and shown to the debugger and to agents, so a secret among them is `Schema.Redacted`, which shows as nothing.
 */

const SECRET = /token|secret|password|passphrase|api_?key|credential|private_?key/i;

export const redactedCommandSecrets: Rule = {
  meta: {
    type: 'problem',
    messages: {
      secret:
        '`{{name}}` looks like a secret, and a command’s arguments are recorded and shown. Make it `Schema.Redacted(…)`, or keep it in a service the command’s Layer gives.',
    },
  },
  create: (context) => ({
    CallExpression: (call) => {
      const spec = call.arguments[1];
      if (calleeName(call) !== 'Command.make' || spec?.type !== 'ObjectExpression') return;
      for (const property of spec.properties) {
        if (
          property.type !== 'Property' ||
          property.key.type !== 'Identifier' ||
          property.key.name !== 'args' ||
          property.value.type !== 'ObjectExpression'
        ) {
          continue;
        }
        for (const field of property.value.properties) {
          if (
            field.type !== 'Property' ||
            field.key.type !== 'Identifier' ||
            !SECRET.test(field.key.name)
          ) {
            continue;
          }
          const redacted =
            field.value.type === 'CallExpression' && calleeName(field.value) === 'Schema.Redacted';
          if (!redacted) {
            context.report({ node: field, messageId: 'secret', data: { name: field.key.name } });
          }
        }
      }
    },
  }),
};
