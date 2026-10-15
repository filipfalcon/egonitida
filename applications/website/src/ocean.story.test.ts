import { expect, it } from '@effect/vitest';
import { Pointing, Story, State } from '@egonitida/core';
import { Option } from 'effect';
import * as Ocean from '#src/ocean.ts';

/** The middle light, and one three places across from it, as far as a ripple spreads in a second. */
const middle = Option.getOrThrow(Ocean.lightAt(4, 4));
const further = Option.getOrThrow(Ocean.lightAt(7, 4));

const given = Story.given(Ocean.state, { viewer: Ocean.viewer, middle, further });

/** How high `light` stands in `state`. */
const heightOf = (state: State.State, light: State.Entity) =>
  Option.map(State.get(state, light, Ocean.Swell), ({ height }) => height);

it('swells every light with the sea, each in its own time', () => {
  const told = Story.story(Ocean.game, given, Story.seconds(1));

  const heights = State.entitiesHolding(told.state, [Ocean.Light]).map((light) =>
    heightOf(told.state, light),
  );

  expect(heights).toHaveLength(Ocean.SIZE * Ocean.SIZE);
  expect(new Set(heights.map((height) => Option.getOrElse(height, () => 0))).size).toBeGreaterThan(
    1,
  );
  for (const height of heights) {
    expect(Option.map(height, (value) => Math.abs(value) < 1)).toEqual(Option.some(true));
  }
});

it('sends a ripple out from a clicked light, which lifts a light further out as it passes', () => {
  const calm = Story.story(Ocean.game, given, Story.seconds(1));
  const rippled = Story.story(
    Ocean.game,
    given,
    Story.act('viewer', Pointing.Clicked, { entity: middle }),
    Story.seconds(1),
  );

  const lifted = Option.map(
    Option.all([heightOf(rippled.state, further), heightOf(calm.state, further)]),
    ([withRipple, without]) => withRipple - without,
  );

  expect(Option.map(lifted, (by) => by > 0.3)).toEqual(Option.some(true));
});

it('lets a ripple go once it has spread across the sea', () => {
  const ripples = (simulation: Story.Simulation) =>
    State.entitiesHolding(simulation.state, [Ocean.Ripple]).length;
  const clicked = Story.story(
    Ocean.game,
    given,
    Story.act('viewer', Pointing.Clicked, { entity: middle }),
    Story.step(),
  );

  expect(ripples(clicked)).toBe(1);
  expect(ripples(Story.seconds(Ocean.RIPPLE_SECONDS)(clicked))).toBe(0);
});

it('sends no ripple from a click on what is not a light', () => {
  const told = Story.story(
    Ocean.game,
    given,
    Story.act('viewer', Pointing.Clicked, { entity: Ocean.viewer }),
    Story.step(),
  );

  expect(State.entitiesHolding(told.state, [Ocean.Ripple])).toEqual([]);
});

it('reads out every light by its place, so the keyboard reaches each one', () => {
  Story.story(
    Ocean.game,
    given,
    Story.expectEqual('middle', Pointing.Label, { text: 'Light 5 across, 5 back' }),
  );
});
