import { describe, expect, it } from '@effect/vitest';
import { World } from '@lightocean/core';
import { Option } from 'effect';
import * as Fingerprint from '#src/Fingerprint.ts';
import * as Fixtures from '#src/fixtures.ts';

const [world] = World.spawn(World.empty({ seed: 7 }), [
  Fixtures.Position.of({ x: 1 }),
  Fixtures.Health.of({ current: 5 }),
]);

describe('a fingerprint', () => {
  it('is the same for worlds that hold the same', () => {
    const [again] = World.spawn(World.empty({ seed: 7 }), [
      Fixtures.Health.of({ current: 5 }),
      Fixtures.Position.of({ x: 1 }),
    ]);

    expect(Fingerprint.of(Fixtures.game, again)).toEqual(Fingerprint.of(Fixtures.game, world));
  });

  it('tells the first component two worlds differ in', () => {
    const [moved] = World.spawn(World.empty({ seed: 7 }), [
      Fixtures.Position.of({ x: 2 }),
      Fixtures.Health.of({ current: 5 }),
    ]);

    expect(
      Fingerprint.difference(
        Fingerprint.of(Fixtures.game, world),
        Fingerprint.of(Fixtures.game, moved),
      ),
    ).toEqual(Option.some({ _tag: 'Component', name: 'Position' }));
  });

  it('tells a component one world holds and the other does not', () => {
    const [unhurt] = World.spawn(World.empty({ seed: 7 }), [Fixtures.Position.of({ x: 1 })]);

    expect(
      Fingerprint.difference(
        Fingerprint.of(Fixtures.game, world),
        Fingerprint.of(Fixtures.game, unhurt),
      ),
    ).toEqual(Option.some({ _tag: 'Component', name: 'Health' }));
  });

  it('tells worlds whose randomness has come apart', () => {
    expect(
      Fingerprint.difference(
        Fingerprint.of(Fixtures.game, world),
        Fingerprint.of(Fixtures.game, { ...world, random: world.random + 1 }),
      ),
    ).toEqual(Option.some({ _tag: 'World', field: 'random' }));
  });

  it('tells no difference between worlds that hold the same', () => {
    expect(
      Fingerprint.difference(
        Fingerprint.of(Fixtures.game, world),
        Fingerprint.of(Fixtures.game, world),
      ),
    ).toEqual(Option.none());
  });
});
