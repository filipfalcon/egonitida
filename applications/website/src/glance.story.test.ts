import { expect, it } from '@effect/vitest';
import { Story, State } from '@lightocean/core';
import * as Glance from '#src/glance.ts';

const [withViewer, viewer] = Glance.setup.join(Glance.state);

const given = Story.given(withViewer, { viewer });

/** The telling as the viewer starts it, with `then` after. */
const started = (...then: ReadonlyArray<Story.Line>) =>
  Story.story(
    Glance.game,
    given,
    Story.act('viewer', Glance.ChoseStart, {}),
    Story.step(),
    ...then,
  );

/** The telling of `state` told on with `then`, the viewer still watching. */
const from = (state: State.State, ...then: ReadonlyArray<Story.Line>) =>
  Story.story(Glance.game, Story.given(state, { viewer }), ...then);

/** The viewer going on to the next beat. */
const goneOn = [Story.act('viewer', Glance.ChoseNext, {}), Story.step()];

/** The viewer going back a beat. */
const goneBack = [Story.act('viewer', Glance.ChoseBack, {}), Story.step()];

/** `seconds` into `beat`, as the viewer starts the telling and goes on to it, a few seconds into every beat before. */
const into = (beat: Glance.Moment, seconds = 0.5) =>
  started(
    ...Array.from({ length: Glance.Moment.literals.indexOf(beat) - 1 }, () => [
      Story.seconds(3),
      ...goneOn,
    ]).flat(),
    Story.seconds(seconds),
  );

const beatOf = (simulation: Story.Simulation) => Glance.momentOf(simulation.state);

const ideasOf = (state: State.State) => State.holding(state, [Glance.Idea]);
const bangsOf = (state: State.State) => State.holding(state, [Glance.Bang]);
const entitiesOf = (state: State.State) => State.query(state, Glance.Body);
const looksOf = (state: State.State) => State.query(state, Glance.Look);
const anglesOf = (state: State.State) =>
  State.query(state, Glance.Place).map(([, { angle }]) => angle);

it('waits at its very beginning, however long time runs, until the viewer starts it', () => {
  expect(beatOf(Story.story(Glance.game, given, Story.seconds(30)))).toBe('Waiting');
});

it('stays at every beat, however long time runs, until the viewer goes on', () => {
  for (const beat of Glance.Moment.literals.slice(1)) {
    expect(beatOf(from(into(beat).state, Story.seconds(30)))).toBe(beat);
  }
});

it('holds nothing at first, then the ideas start coming, as many as there may be at most', () => {
  const ideas = into('Ideas');

  expect(ideasOf(started(Story.seconds(30)).state)).toEqual([]);
  expect(ideasOf(ideas.state).length).toBeGreaterThan(0);
  expect(ideasOf(from(ideas.state, Story.seconds(30)).state)).toHaveLength(Glance.MOST_IDEAS);
});

it('has the state emerge from the point the ideas were pressed into, as the viewer goes on from them', () => {
  const state = into('State');

  expect(ideasOf(state.state)).toEqual([]);
  expect(bangsOf(state.state)).toHaveLength(1);
  expect(entitiesOf(state.state)).toEqual([]);
});

it('has entities emerge one after another, each holding only which of them it is, until all have', () => {
  const emerging = into('Entities', 1);
  const emerged = into('Entities', 10);

  expect(entitiesOf(emerging.state).length).toBeGreaterThan(0);
  expect(entitiesOf(emerging.state).length).toBeLessThan(Glance.PLANETS);
  expect(entitiesOf(emerged.state).map(([, { index }]) => index)).toEqual([0, 1, 2, 3, 4]);
  expect(looksOf(emerged.state)).toEqual([]);
  expect(State.query(emerged.state, Glance.Place)).toEqual([]);
});

it('gives every entity its look and its place once the viewer goes on to components, each further out than the one before', () => {
  const given = into('Components');
  const distances = State.query(given.state, Glance.Place).map(([, { distance }]) => distance);

  expect(looksOf(given.state)).toHaveLength(Glance.PLANETS);
  expect(distances).toHaveLength(Glance.PLANETS);
  expect(distances).toEqual(distances.toSorted((one, other) => one - other));
});

it('gives every entity its components, all there, even when the viewer goes on before they all emerged', () => {
  const hurried = started(...goneOn, ...goneOn, ...goneOn, ...goneOn);

  expect(beatOf(hurried)).toBe('Components');
  expect(entitiesOf(hurried.state)).toHaveLength(Glance.PLANETS);
  expect(looksOf(hurried.state)).toHaveLength(Glance.PLANETS);
});

it('keeps the planets still until time starts stepping, and from then moves every one round a stride each step', () => {
  const given = into('Components');
  const stepped = from(given.state, ...goneOn);
  const next = Story.step()(stepped);

  expect(anglesOf(from(given.state, Story.seconds(5)).state)).toEqual(anglesOf(given.state));
  const strides = anglesOf(next.state).map(
    (angle, index) => (angle - (anglesOf(stepped.state)[index] ?? 0) + 360) % 360,
  );
  const expected = State.query(stepped.state, Glance.Place).map(([, { distance }]) =>
    Glance.strideAt(distance),
  );
  expect(strides).toHaveLength(Glance.PLANETS);
  strides.forEach((stride, index) => expect(stride).toBeCloseTo(expected[index] ?? 0, 9));
});

it('comes to the step a state begins from as time starts stepping, and goes no further', () => {
  const stepped = into('Step');

  expect(Glance.isAboutToBegin(stepped.state)).toBe(true);
  expect(beatOf(from(stepped.state, ...goneOn))).toBe('Step');
});

it('begins the state at its first tick as time starts stepping, holding all it held, every tick it remembers counted from there', () => {
  const stepped = into('Step').state;
  const state = Glance.begun(stepped);
  const sinceOf = (held: State.State) => entitiesOf(held).map(([, { since }]) => since);

  expect(state.tick).toBe(0);
  expect(Glance.momentOf(state)).toBe('Step');
  expect(Glance.isAboutToBegin(state)).toBe(false);
  expect(State.entities(state)).toEqual(State.entities(stepped));
  expect(sinceOf(state)).toEqual(sinceOf(stepped).map((since) => since - stepped.tick));
  expect(State.holding(state, [Glance.Eye])).toEqual([viewer]);
});

it('goes back a beat when the viewer chooses it, letting go of what came with the beat it leaves', () => {
  const noComponents = from(into('Components').state, ...goneBack);
  const noEntities = from(into('Entities').state, ...goneBack);
  const noState = from(into('State').state, ...goneBack);
  const noIdeas = from(into('Ideas').state, ...goneBack);

  expect(beatOf(noComponents)).toBe('Entities');
  expect(looksOf(noComponents.state)).toEqual([]);
  expect(beatOf(noEntities)).toBe('State');
  expect(entitiesOf(noEntities.state)).toEqual([]);
  expect(beatOf(noState)).toBe('Ideas');
  expect(bangsOf(noState.state)).toEqual([]);
  expect(beatOf(noIdeas)).toBe('Nothing');
  expect(ideasOf(noIdeas.state)).toEqual([]);
});

it('comes to the step a state begins from again once the viewer has gone back from it', () => {
  const again = from(Glance.begun(into('Step').state), ...goneBack, ...goneOn);

  expect(beatOf(again)).toBe('Step');
  expect(Glance.isAboutToBegin(again.state)).toBe(true);
});

it('steps the same way from the same state, as its randomness is the state’s own', () => {
  const once = into('Step', 1);
  const again = into('Step', 1);

  expect(again.state.random).toBe(once.state.random);
  expect(State.query(again.state, Glance.Place)).toEqual(State.query(once.state, Glance.Place));
});
