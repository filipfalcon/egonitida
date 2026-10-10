import { describe, expect, it } from '@effect/vitest';
import { Option } from 'effect';
import { Controls, Health, Position, Splat, Velocity } from '#src/fixtures.ts';
import type * as Component from '#src/Component.ts';
import * as Snapshot from '#src/Snapshot.ts';
import * as World from '#src/World.ts';

const components = [Position, Velocity, Health, Controls, Splat];

const [withRunner, runner] = World.spawn(World.empty({ seed: 9 }), [
  Position.of({ x: 3 }),
  Velocity.of({ x: 1 }),
  Health.of({ current: 80 }),
  Controls.of({ move: 0.5, fire: true }),
]);
const [server, splat] = World.spawn(withRunner, [Position.of({ x: 4 }), Splat.of({ size: 2 })]);

describe('Snapshot', () => {
  it('carries a world to a client, component for component', () => {
    const received = Snapshot.apply(
      World.empty({ seed: 0 }),
      Snapshot.encode(server, components),
      components,
    );
    const world = Option.getOrThrow(received);

    expect(world.tick).toBe(server.tick);
    expect(world.nextEntity).toBe(server.nextEntity);
    expect(world.random).toBe(server.random);
    const sameIn = <Value>(component: Component.Component<string, Value, Component.Owner>) =>
      expect(World.query(world, component)).toEqual(World.query(server, component));
    sameIn(Position);
    sameIn(Velocity);
    sameIn(Health);
    sameIn(Controls);
  });

  it('never sends what is local, and leaves the client its own', () => {
    const [client] = World.spawn(World.empty({ seed: 0 }), [Splat.of({ size: 7 })]);
    const world = Option.getOrThrow(
      Snapshot.apply(client, Snapshot.encode(server, components), components),
    );

    expect(Snapshot.encode(server, components)).not.toContain('Splat');
    expect(World.get(world, splat, Splat)).toEqual(Option.none());
    expect(World.query(world, Splat).map(([, value]) => value)).toEqual([{ size: 7 }]);
  });

  it('rejects a snapshot it cannot trust, keeping nothing of it', () => {
    const client = World.empty({ seed: 0 });
    const forged = Snapshot.encode(server, components).replace('"current":80', '"current":"lots"');

    expect(Snapshot.apply(client, 'not json', components)).toEqual(Option.none());
    expect(Snapshot.apply(client, forged, components)).toEqual(Option.none());
  });

  it('ignores a component the client does not know', () => {
    const world = Snapshot.apply(World.empty({ seed: 0 }), Snapshot.encode(server, components), [
      Position,
    ]).pipe(Option.getOrThrow);

    expect(World.get(world, runner, Position)).toEqual(Option.some({ x: 3 }));
    expect(World.get(world, runner, Health)).toEqual(Option.none());
  });
});
