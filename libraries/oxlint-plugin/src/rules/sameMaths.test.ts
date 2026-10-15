import { tester } from '#src/tester.ts';
import { sameMaths } from '#src/rules/sameMaths.ts';

tester.run('same-maths', sameMaths, {
  valid: [
    // A step's maths, from the maths every engine works out alike.
    `const heading = (x, z) => Maths.atan2(-x, -z); export const walk = System.make({ name: 'walk', reads: [], writes: [], emits: [], run: () => Maths.hypot(1, 2) * Math.sqrt(2) });`,
    // What is exact anywhere: roots, rounding, the least and the most.
    `export const domain = Domain.make({ name: 'Cube' }); const near = Math.sqrt(Math.floor(2.5) + Math.abs(-1) + Math.min(1, 2));`,
    // A view draws with the browser's maths, as only it draws.
    `export const spin = View.each([Spin], { acquire: () => Effect.succeed(new Group()), draw: (group, held) => { group.rotation.y = Math.atan2(1, 2) ** 2; } });`,
    // A story steps the game, but is a test.
    {
      code: `const domain = Domain.make({ name: 'Cube' }); const far = Math.hypot(3, 4);`,
      filename: 'cube.story.test.ts',
    },
  ],
  invalid: [
    {
      code: `export const walk = System.make({ name: 'walk', reads: [], writes: [], emits: [], run: () => Math.atan2(1, 2) });`,
      errors: [{ messageId: 'approximate' }],
    },
    {
      // A helper a system calls, anywhere in the module that makes it.
      code: `const heading = (x, z) => Math.atan2(-x, -z) + Math.cos(x); export const domain = Domain.make({ name: 'Player' });`,
      errors: [{ messageId: 'approximate' }, { messageId: 'approximate' }],
    },
    {
      code: `const falloff = (t) => (1 - t) ** 2; export const fade = Rule.on(Faded, { reads: [], writes: [], emits: [], run: () => {} });`,
      errors: [{ messageId: 'power' }],
    },
  ],
});
