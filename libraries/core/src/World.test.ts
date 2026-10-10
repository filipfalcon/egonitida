import { describe, expect, it } from '@effect/vitest';
import { Option } from 'effect';
import { Health, Position, Velocity } from '#src/fixtures.ts';
import * as World from '#src/World.ts';

describe('World', () => {
  it('starts empty, at tick zero', () => {
    const world = World.empty({ seed: 1 });

    expect(world.tick).toBe(0);
    expect(World.query(world, Position)).toEqual([]);
  });

  it('spawns an entity with its components, under a new id each time', () => {
    const [once, first] = World.spawn(World.empty({ seed: 1 }), [Position.of({ x: 1 })]);
    const [twice, second] = World.spawn(once, [Position.of({ x: 2 }), Health.of({ current: 10 })]);

    expect(first).not.toBe(second);
    expect(World.get(twice, first, Position)).toEqual(Option.some({ x: 1 }));
    expect(World.get(twice, second, Health)).toEqual(Option.some({ current: 10 }));
    expect(World.get(twice, first, Health)).toEqual(Option.none());
  });

  it('queries every entity holding all the given components, in id order', () => {
    const [one, a] = World.spawn(World.empty({ seed: 1 }), [
      Position.of({ x: 1 }),
      Velocity.of({ x: 5 }),
    ]);
    const [two] = World.spawn(one, [Position.of({ x: 2 })]);
    const [three, c] = World.spawn(two, [Velocity.of({ x: 7 }), Position.of({ x: 3 })]);

    expect(World.query(three, Position, Velocity)).toEqual([
      [a, { x: 1 }, { x: 5 }],
      [c, { x: 3 }, { x: 7 }],
    ]);
  });

  it('despawns an entity with all its components', () => {
    const [spawned, entity] = World.spawn(World.empty({ seed: 1 }), [
      Position.of({ x: 1 }),
      Health.of({ current: 10 }),
    ]);
    const despawned = World.despawn(spawned, entity);

    expect(World.get(despawned, entity, Position)).toEqual(Option.none());
    expect(World.get(despawned, entity, Health)).toEqual(Option.none());
  });

  it('never changes a world it was given, so any past world can be kept', () => {
    const [before, entity] = World.spawn(World.empty({ seed: 1 }), [Position.of({ x: 1 })]);
    World.despawn(before, entity);

    expect(World.get(before, entity, Position)).toEqual(Option.some({ x: 1 }));
  });

  it('cannot be changed through a store of a finished world', () => {
    const [world, entity] = World.spawn(World.empty({ seed: 1 }), [Position.of({ x: 1 })]);

    Position.set(world.stores.get(Position.name), entity, { x: 99 });

    expect(World.get(world, entity, Position)).toEqual(Option.some({ x: 1 }));
  });
});
