import { tester } from '#src/tester.ts';
import { noIndexKeys } from '#src/rules/noIndexKeys.ts';

tester.run('no-index-keys', noIndexKeys, {
  valid: [
    `const nodes = objects.map((object) => Scene.mesh({ key: object.id, geometry, material }));`,
    `const nodes = objects.map((object, index) => Scene.mesh({ key: object.id, position: [index, 0, 0] }));`,
  ],
  invalid: [
    {
      code: `const nodes = objects.map((object, index) => Scene.mesh({ key: String(index), geometry }));`,
      errors: [{ messageId: 'index' }],
    },
    {
      code: `const nodes = objects.map((object, at) => Scene.mesh({ key: \`cube-\${at}\` }));`,
      errors: [{ messageId: 'index' }],
    },
  ],
});
