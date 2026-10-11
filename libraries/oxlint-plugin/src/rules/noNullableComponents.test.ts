import { tester } from '#src/tester.ts';
import { noNullableComponents } from '#src/rules/noNullableComponents.ts';

tester.run('no-nullable-components', noNullableComponents, {
  valid: [
    `Component.make('Aim', Schema.Struct({ target: Schema.Option(Schema.Int) }), { owner: 'rules', network: 'server' });`,
    // Not a component's schema: an action's fields may be what they need.
    `const Payload = Schema.Struct({ note: Schema.optional(Schema.String) });`,
  ],
  invalid: [
    {
      code: `Component.make('Aim', Schema.Struct({ target: Schema.NullOr(Schema.Int), since: Schema.optional(Schema.Int) }), { owner: 'rules', network: 'server' });`,
      errors: [{ messageId: 'nullable' }, { messageId: 'nullable' }],
    },
    {
      code: `Component.make('Aim', Schema.Struct({ target: Schema.UndefinedOr(Schema.Int) }), { owner: 'rules', network: 'server' });`,
      errors: [{ messageId: 'nullable' }],
    },
  ],
});
