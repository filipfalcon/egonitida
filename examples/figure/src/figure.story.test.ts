import { describe, expect, it } from '@effect/vitest';
import { Story } from '@egonitida/core';
import * as Figure from '#src/figure.ts';

const [joined, figure] = Figure.join(Figure.state);
const asMade = Story.given(joined, { figure });

describe('a figure', () => {
  it('turns a dial a step toward more or toward less, and no other', () => {
    Story.story(
      Figure.game,
      asMade,
      Story.act('figure', Figure.TurnedDial, { dial: 'hips', toward: 'More' }),
      Story.step(),
      Story.act('figure', Figure.TurnedDial, { dial: 'legs', toward: 'Less' }),
      Story.step(),
      Story.expect('figure', Figure.Shape, (shape) =>
        expect(shape).toEqual({ chest: 0, hips: Figure.STEP, legs: -Figure.STEP }),
      ),
    );
  });

  it('never turns a dial past a whole either way', () => {
    const turns = Array.from({ length: 6 }, () => [
      Story.act('figure', Figure.TurnedDial, { dial: 'chest', toward: 'More' }),
      Story.step(),
    ]).flat();

    Story.story(
      Figure.game,
      asMade,
      ...turns,
      Story.expect('figure', Figure.Shape, ({ chest }) => expect(chest).toEqual(Figure.FARTHEST)),
    );
  });
});
