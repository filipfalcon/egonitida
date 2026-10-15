import { expect, it } from '@effect/vitest';
import { Story } from '@nitida/core';
import * as Cube from '#src/cube.ts';

it('turns a cube once every four seconds', () => {
  Story.story(
    Cube.game,
    Story.given(Cube.state, { cube: Cube.cube }),
    Story.seconds(1),
    Story.expect('cube', Cube.Spin, ({ angle }) => expect(angle).toBeCloseTo(Math.PI / 2)),
    Story.seconds(3),
    Story.expect('cube', Cube.Spin, ({ angle }) => expect(angle).toBeCloseTo(Math.PI * 2)),
  );
});
