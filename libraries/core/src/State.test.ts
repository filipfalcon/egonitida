import { describe, expect, it } from '@effect/vitest';
import { Option } from 'effect';
import { Health, Position, Velocity } from '#src/fixtures.ts';
import * as State from '#src/State.ts';

describe('State', () => {
  it('starts empty, at tick zero', () => {
    const state = State.empty({ seed: 1 });

    expect(state.tick).toBe(0);
    expect(State.query(state, Position)).toEqual([]);
  });

  it('spawns an entity with its components, under a new id each time', () => {
    const [once, first] = State.spawn(State.empty({ seed: 1 }), [Position.of({ x: 1 })]);
    const [twice, second] = State.spawn(once, [Position.of({ x: 2 }), Health.of({ current: 10 })]);

    expect(first).not.toBe(second);
    expect(State.get(twice, first, Position)).toEqual(Option.some({ x: 1 }));
    expect(State.get(twice, second, Health)).toEqual(Option.some({ current: 10 }));
    expect(State.get(twice, first, Health)).toEqual(Option.none());
  });

  it('queries every entity holding all the given components, in id order', () => {
    const [one, a] = State.spawn(State.empty({ seed: 1 }), [
      Position.of({ x: 1 }),
      Velocity.of({ x: 5 }),
    ]);
    const [two] = State.spawn(one, [Position.of({ x: 2 })]);
    const [three, c] = State.spawn(two, [Velocity.of({ x: 7 }), Position.of({ x: 3 })]);

    expect(State.query(three, Position, Velocity)).toEqual([
      [a, { x: 1 }, { x: 5 }],
      [c, { x: 3 }, { x: 7 }],
    ]);
  });

  it('despawns an entity with all its components', () => {
    const [spawned, entity] = State.spawn(State.empty({ seed: 1 }), [
      Position.of({ x: 1 }),
      Health.of({ current: 10 }),
    ]);
    const despawned = State.despawn(spawned, entity);

    expect(State.get(despawned, entity, Position)).toEqual(Option.none());
    expect(State.get(despawned, entity, Health)).toEqual(Option.none());
  });

  it('never changes a state it was given, so any past state can be kept', () => {
    const [before, entity] = State.spawn(State.empty({ seed: 1 }), [Position.of({ x: 1 })]);
    State.despawn(before, entity);

    expect(State.get(before, entity, Position)).toEqual(Option.some({ x: 1 }));
  });

  it('cannot be changed through a store of a finished state', () => {
    const [state, entity] = State.spawn(State.empty({ seed: 1 }), [Position.of({ x: 1 })]);

    Position.set(state.stores.get(Position.name), entity, { x: 99 });

    expect(State.get(state, entity, Position)).toEqual(Option.some({ x: 1 }));
  });
});
