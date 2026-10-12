import { expect, it } from '@effect/vitest';
import { Story, State } from '@lightocean/core';
import { Option } from 'effect';
import * as Press from '#src/press.ts';

const given = Story.given(Press.state, {
  tree: Press.tree,
  volcano: Press.volcano,
  dragon: Press.dragon,
  warrior: Press.warrior,
});

const longitudeOf = (state: State.State, entity: State.Entity) =>
  Option.map(State.get(state, entity, Press.Position), ({ longitude }) => longitude);

it('holds a tree, a volcano, a dragon, and a warrior on its globe', () => {
  const kinds = State.query(Press.state, Press.Shape).map(([, { kind }]) => kind);

  expect(kinds).toEqual(['Tree', 'Volcano', 'Dragon', 'Warrior']);
});

it('moves the dragon and the warrior round the globe by their strides, and on round past the full circle', () => {
  const steps = Array.from({ length: 16 }, () => Story.step());
  const told = Story.story(Press.game, given, ...steps);

  expect(longitudeOf(told.state, Press.dragon)).toEqual(
    Option.map(longitudeOf(Press.state, Press.dragon), (start) => (start + 16 * 30) % 360),
  );
  expect(longitudeOf(told.state, Press.warrior)).toEqual(
    Option.map(longitudeOf(Press.state, Press.warrior), (start) => (start + 16 * 12) % 360),
  );
});

it('leaves the tree and the volcano where they stand', () => {
  const told = Story.story(Press.game, given, Story.step(), Story.step(), Story.step());

  expect(longitudeOf(told.state, Press.tree)).toEqual(longitudeOf(Press.state, Press.tree));
  expect(longitudeOf(told.state, Press.volcano)).toEqual(longitudeOf(Press.state, Press.volcano));
});

it('withers the health of what holds it on an unlucky step, and restores it once it runs low', () => {
  const healthOf = (state: State.State) =>
    Option.getOrElse(
      Option.map(State.get(state, Press.warrior, Press.Health), ({ current }) => current),
      () => 0,
    );
  let told = Story.story(Press.game, given);
  const seen: Array<number> = [];
  for (let step = 0; step < 12; step++) {
    told = Story.step()(told);
    seen.push(healthOf(told.state));
  }

  expect(new Set(seen).size).toBeGreaterThan(1);
  for (const health of seen) {
    expect(health).toBeGreaterThanOrEqual(4);
    expect(health).toBeLessThanOrEqual(14);
  }
});

it('steps the same way from the same state, as its randomness is the state’s own', () => {
  const once = Story.story(Press.game, given, Story.step(), Story.step(), Story.step());
  const again = Story.story(Press.game, given, Story.step(), Story.step(), Story.step());

  expect(again.state.random).toBe(once.state.random);
  expect(State.get(again.state, Press.warrior, Press.Health)).toEqual(
    State.get(once.state, Press.warrior, Press.Health),
  );
});
