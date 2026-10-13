import { tester } from '#src/tester.ts';
import { viewsKeepNothing } from '#src/rules/viewsKeepNothing.ts';

tester.run('views-keep-nothing', viewsKeepNothing, {
  valid: [
    // Its own object, changed in place, and what it works out for this frame.
    `View.each([Crate, Position], { acquire: () => Effect.succeed(new Group()), draw: (group, held) => { let x = held(Position).x; x += 1; group.position.x = x; group.visible = true; } });`,
    // Outside a view's draw, keeping is not this rule's business.
    `let frames = 0; const tick = () => { frames += 1; };`,
  ],
  invalid: [
    {
      code: `let flashes = 0; View.whole({ acquire: () => Effect.succeed(new PointLight()), draw: () => { flashes += 1; } });`,
      errors: [{ messageId: 'keeps' }],
    },
    {
      code: `let drawn = 0; View.each([Crate], { acquire: () => Effect.succeed(new Group()), draw: () => { drawn += 1; } });`,
      errors: [{ messageId: 'keeps' }],
    },
    {
      code: `const seen = { last: 0 }; View.each([Crate], { acquire: () => Effect.succeed(new Group()), draw: (group) => { seen.last = group.position.x; } });`,
      errors: [{ messageId: 'keeps' }],
    },
  ],
});
