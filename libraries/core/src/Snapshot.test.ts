import { describe, expect, it } from '@effect/vitest';
import { Option } from 'effect';
import type * as Component from '#src/Component.ts';
import { Controls, fixture, Health, Position, Splat, Velocity, Wall } from '#src/fixtures.ts';
import * as Game from '#src/Game.ts';
import * as Domain from '#src/Domain.ts';
import * as Snapshot from '#src/Snapshot.ts';
import * as World from '#src/World.ts';

const game = Game.only(fixture, { systems: [], rules: [] });

const [withRunner] = World.spawn(World.empty({ seed: 9 }), [
  Position.of({ x: 3 }),
  Velocity.of({ x: 1 }),
  Health.of({ current: 80 }),
  Controls.of({ move: 0.5, fire: true }),
]);
const [withSplat, splat] = World.spawn(withRunner, [Position.of({ x: 4 }), Splat.of({ size: 2 })]);
const [server] = World.spawn(withSplat, [Wall.of({ x: 12 })]);

describe('Snapshot', () => {
  it('carries a world to a client, component for component', () => {
    const received = Snapshot.apply(World.empty({ seed: 0 }), Snapshot.encode(server, game), game);
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
    const world = Option.getOrThrow(Snapshot.apply(client, Snapshot.encode(server, game), game));

    expect(Snapshot.encode(server, game)).not.toContain('Splat');
    expect(World.get(world, splat, Splat)).toEqual(Option.none());
    expect(World.query(world, Splat).map(([, value]) => value)).toEqual([{ size: 7 }]);
  });

  it('takes what a client keeps on an entity the server no longer holds away with it', () => {
    const [onRunner] = World.spawn(World.empty({ seed: 0 }), [Splat.of({ size: 1 })]);
    const gone = World.despawn(server, 0);
    const world = Option.getOrThrow(Snapshot.apply(onRunner, Snapshot.encode(gone, game), game));

    expect(World.query(world, Splat)).toEqual([]);
  });

  it('keeps the entities a client spawned for itself, and the count of their ids', () => {
    const draft = World.draft(World.empty({ seed: 0 }));
    const own = World.spawnLocalInto(draft, [Splat.of({ size: 3 })]);
    const client = World.finish(draft);
    const world = Option.getOrThrow(Snapshot.apply(client, Snapshot.encode(server, game), game));

    expect(World.get(world, own, Splat)).toEqual(Option.some({ size: 3 }));
    expect(world.nextLocal).toBe(client.nextLocal);
  });

  it('never sends what is private to the server', () => {
    const world = Option.getOrThrow(
      Snapshot.apply(World.empty({ seed: 0 }), Snapshot.encode(server, game), game),
    );

    expect(Snapshot.encode(server, game)).not.toContain('Wall');
    expect(World.query(world, Wall)).toEqual([]);
  });

  it('rejects a snapshot it cannot trust, keeping nothing of it', () => {
    const client = World.empty({ seed: 0 });
    const forged = Snapshot.encode(server, game).replace('"current":80', '"current":"lots"');

    expect(Snapshot.apply(client, 'not json', game)).toEqual(Option.none());
    expect(Snapshot.apply(client, forged, game)).toEqual(Option.none());
  });

  it('rejects a snapshot from a game made of other components', () => {
    const smaller = Game.make({
      stepRate: 10,
      domains: [
        Domain.make({
          name: 'Test',
          requires: [],
          components: [Position],
          actions: [],
          events: [],
          systems: [],
          rules: [],
        }),
      ],
    });

    expect(
      Snapshot.apply(World.empty({ seed: 0 }), Snapshot.encode(server, game), smaller),
    ).toEqual(Option.none());
  });

  it('takes away what the server no longer holds', () => {
    const [client] = World.spawn(World.empty({ seed: 0 }), [Health.of({ current: 5 })]);
    const [empty] = World.spawn(World.empty({ seed: 0 }), [Position.of({ x: 1 })]);
    const world = Option.getOrThrow(Snapshot.apply(client, Snapshot.encode(empty, game), game));

    expect(World.query(world, Health)).toEqual([]);
  });
});
