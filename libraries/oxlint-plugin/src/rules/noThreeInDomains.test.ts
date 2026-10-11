import { tester } from '#src/tester.ts';
import { noThreeInDomains } from '#src/rules/noThreeInDomains.ts';

tester.run('no-three-in-domains', noThreeInDomains, {
  valid: [
    // A view module draws with Three.js.
    `import * as Three from 'three/webgpu'; export const cubes = View.each([Spin], { acquire: () => Effect.succeed(new Three.Mesh()), draw: () => {} });`,
    // A domain module without Three.js.
    `import { Domain } from '@lightocean/core'; export const domain = Domain.make({ name: 'Cube' });`,
    // A scene test tells a game and draws it in one file.
    {
      code: `import * as Three from 'three/webgpu'; const domain = Domain.make({ name: 'Cube' });`,
      filename: 'cube.scene.test.ts',
    },
  ],
  invalid: [
    {
      code: `import { Vector3 } from 'three'; export const turn = System.make({ name: 'turn', reads: [], writes: [], emits: [], run: () => {} });`,
      errors: [{ messageId: 'three' }],
    },
    {
      code: `import * as Three from 'three/webgpu'; export const domain = Domain.make({ name: 'Cube' });`,
      errors: [{ messageId: 'three' }],
    },
  ],
});
