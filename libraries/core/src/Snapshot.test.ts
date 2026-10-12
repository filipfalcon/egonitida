import { describe, expect, it } from '@effect/vitest';
import { Option } from 'effect';
import type * as Component from '#src/Component.ts';
import { Controls, fixture, Health, Position, Splat, Velocity, Wall } from '#src/fixtures.ts';
import * as Game from '#src/Game.ts';
import * as Domain from '#src/Domain.ts';
import * as Snapshot from '#src/Snapshot.ts';
import * as State from '#src/State.ts';

const game = Game.only(fixture, { systems: [], rules: [] });

const [withRunner] = State.spawn(State.empty({ seed: 9 }), [
  Position.of({ x: 3 }),
  Velocity.of({ x: 1 }),
  Health.of({ current: 80 }),
  Controls.of({ move: 0.5, fire: true }),
]);
const [withSplat, splat] = State.spawn(withRunner, [Position.of({ x: 4 }), Splat.of({ size: 2 })]);
const [server] = State.spawn(withSplat, [Wall.of({ x: 12 })]);

describe('Snapshot', () => {
  it('carries a state to a client, component for component', () => {
    const received = Snapshot.apply(State.empty({ seed: 0 }), Snapshot.encode(server, game), game);
    const { state } = Option.getOrThrow(received);

    expect(state.tick).toBe(server.tick);
    expect(state.nextEntity).toBe(server.nextEntity);
    expect(state.random).toBe(server.random);
    const sameIn = <Value>(component: Component.Component<string, Value, Component.Owner>) =>
      expect(State.query(state, component)).toEqual(State.query(server, component));
    sameIn(Position);
    sameIn(Velocity);
    sameIn(Health);
    sameIn(Controls);
  });

  it('never sends what is local, and leaves the client its own', () => {
    const [client] = State.spawn(State.empty({ seed: 0 }), [Splat.of({ size: 7 })]);
    const state = Option.getOrThrow(
      Snapshot.apply(client, Snapshot.encode(server, game), game),
    ).state;

    expect(Snapshot.encode(server, game)).not.toContain('Splat');
    expect(State.get(state, splat, Splat)).toEqual(Option.none());
    expect(State.query(state, Splat).map(([, value]) => value)).toEqual([{ size: 7 }]);
  });

  it('takes what a client keeps on an entity the server no longer holds away with it', () => {
    const [onRunner] = State.spawn(State.empty({ seed: 0 }), [Splat.of({ size: 1 })]);
    const gone = State.despawn(server, 0);
    const state = Option.getOrThrow(
      Snapshot.apply(onRunner, Snapshot.encode(gone, game), game),
    ).state;

    expect(State.query(state, Splat)).toEqual([]);
  });

  it('keeps the entities a client spawned for itself, and the count of their ids', () => {
    const draft = State.draft(State.empty({ seed: 0 }));
    const own = State.spawnLocalInto(draft, [Splat.of({ size: 3 })]);
    const client = State.finish(draft);
    const state = Option.getOrThrow(
      Snapshot.apply(client, Snapshot.encode(server, game), game),
    ).state;

    expect(State.get(state, own, Splat)).toEqual(Option.some({ size: 3 }));
    expect(state.nextLocal).toBe(client.nextLocal);
  });

  it('never sends what is private to the server', () => {
    const { state } = Option.getOrThrow(
      Snapshot.apply(State.empty({ seed: 0 }), Snapshot.encode(server, game), game),
    );

    expect(Snapshot.encode(server, game)).not.toContain('Wall');
    expect(State.query(state, Wall)).toEqual([]);
  });

  it('carries the era a state was sent in', () => {
    const sent = Snapshot.apply(State.empty({ seed: 0 }), Snapshot.encode(server, game, 3), game);

    expect(Option.map(sent, ({ era }) => era)).toEqual(Option.some(3));
  });

  it('rejects a snapshot it cannot trust, keeping nothing of it', () => {
    const client = State.empty({ seed: 0 });
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
      Snapshot.apply(State.empty({ seed: 0 }), Snapshot.encode(server, game), smaller),
    ).toEqual(Option.none());
  });

  it('takes away what the server no longer holds', () => {
    const [client] = State.spawn(State.empty({ seed: 0 }), [Health.of({ current: 5 })]);
    const [empty] = State.spawn(State.empty({ seed: 0 }), [Position.of({ x: 1 })]);
    const state = Option.getOrThrow(
      Snapshot.apply(client, Snapshot.encode(empty, game), game),
    ).state;

    expect(State.query(state, Health)).toEqual([]);
  });
});
