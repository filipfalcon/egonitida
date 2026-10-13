import { tester } from '#src/tester.ts';
import { pureSteps } from '#src/rules/pureSteps.ts';

tester.run('pure-steps', pureSteps, {
  valid: [
    // Randomness and time from the context.
    `System.make({ name: 'scatter', reads: [], writes: [], emits: [], run: (context) => context.random() + context.time.tick });`,
    // Outside a step, anything goes.
    `const seed = Math.random(); const now = Date.now();`,
    // A view draws its randomness from the frame.
    `View.each([Crate], { acquire: (held, frame, entity) => Effect.succeed(new Group()), draw: (group, held, frame) => { group.rotation.y = frame.random(1, 'tilt')(); } });`,
    // A view's acquire may do Effect work; only its draw runs every frame.
    `View.each([Crate], { acquire: () => Effect.succeed(new Group()), draw: (group) => { group.visible = true; } });`,
  ],
  invalid: [
    {
      code: `View.follow({ of: () => Math.random() > 0.5, to: (lit) => Effect.void });`,
      errors: [{ messageId: 'impure' }],
    },
    {
      code: `View.whole({ acquire: () => Effect.succeed(new PointLight()), draw: (light) => { light.intensity = Math.random(); } });`,
      errors: [{ messageId: 'impure' }],
    },
    {
      code: `View.each([Wreck], { acquire: () => Effect.sync(() => { const wreck = new Group(); wreck.rotation.y = Math.random(); return wreck; }), draw: () => {} });`,
      errors: [{ messageId: 'impure' }],
    },
    {
      code: `System.make({ name: 'scatter', reads: [], writes: [], emits: [], run: () => Math.random() });`,
      errors: [{ messageId: 'impure' }],
    },
    {
      code: `Rule.on(Died, { reads: [], writes: [], emits: [], run: function () { return Date.now() + performance.now(); } });`,
      errors: [{ messageId: 'impure' }, { messageId: 'impure' }],
    },
    {
      code: `System.make({ name: 'stamp', reads: [], writes: [], emits: [], run: () => { const at = new Date(); crypto.randomUUID(); } });`,
      errors: [{ messageId: 'impure' }, { messageId: 'impure' }],
    },
    {
      code: `View.each([Crate], { acquire: () => Effect.succeed(new Group()), draw: () => Effect.runSync(Effect.succeed(1)) });`,
      errors: [{ messageId: 'effect' }, { messageId: 'effect' }],
    },
  ],
});
