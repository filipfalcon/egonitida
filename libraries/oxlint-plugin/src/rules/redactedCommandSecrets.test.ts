import { tester } from '#src/tester.ts';
import { redactedCommandSecrets } from '#src/rules/redactedCommandSecrets.ts';

tester.run('redacted-command-secrets', redactedCommandSecrets, {
  valid: [
    `Command.make('Save', { args: { level: Schema.Int, token: Schema.Redacted(Schema.String) }, results: [], execute: () => Effect.die('') });`,
  ],
  invalid: [
    {
      code: `Command.make('Save', { args: { apiKey: Schema.String, password: Schema.String, level: Schema.Int }, results: [], execute: () => Effect.die('') });`,
      errors: [{ messageId: 'secret' }, { messageId: 'secret' }],
    },
  ],
});
