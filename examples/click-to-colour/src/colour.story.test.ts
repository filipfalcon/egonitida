import { expect, it } from '@effect/vitest';
import { Pointing, Story } from '@nitida/core';
import * as Colour from '#src/colour.ts';

const given = Story.given(Colour.state, {
  left: Colour.left,
  middle: Colour.middle,
  viewer: Colour.viewer,
});

it('paints a cube the next colour of the palette at every click, and round again', () => {
  Story.story(
    Colour.game,
    given,
    Story.act('viewer', Pointing.Clicked, { entity: Colour.middle }),
    Story.step(),
    Story.expectEqual('middle', Colour.Paint, { shade: 1 }),
    Story.expectEqual('left', Colour.Paint, { shade: 0 }),
    ...Array.from({ length: Colour.PALETTE.length - 1 }, () => [
      Story.act('viewer', Pointing.Clicked, { entity: Colour.middle }),
      Story.step(),
    ]).flat(),
    Story.expectEqual('middle', Colour.Paint, { shade: 0 }),
  );
});

it('labels every cube by where it stands', () => {
  Story.story(
    Colour.game,
    given,
    Story.expect('left', Pointing.Label, ({ text }) => expect(text).toBe('Left cube')),
  );
});
