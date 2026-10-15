import { describe, expect, it } from '@effect/vitest';
import { Component, Domain, Game } from '@egonitida/core';
import { Option, Schema } from 'effect';
import * as Version from '#src/Version.ts';

/** A game of one component, Health, as `schema` has it: as an earlier and a later build might each have it. */
const gameWith = (schema: Schema.Codec<{ readonly current: number }, unknown>) =>
  Game.make({
    stepRate: 60,
    domains: [
      Domain.make({
        name: 'Healing',
        requires: [],
        components: [Component.make('Health', schema, { owner: 'rules', network: 'server' })],
        actions: [],
        events: [],
        systems: [],
        rules: [],
      }),
    ],
  });
const whole = gameWith(Schema.Struct({ current: Schema.Int }));
const halving = gameWith(Schema.Struct({ current: Schema.Finite }));

describe('Version.mismatch', () => {
  it('is none for the same build', () => {
    const version = Version.of(whole, Option.some('a'));
    expect(Version.mismatch(version, version)).toEqual(Option.none());
  });

  it('is another build, though no component changed', () => {
    expect(
      Version.mismatch(Version.of(whole, Option.some('a')), Version.of(whole, Option.some('b'))),
    ).toEqual(
      Option.some({
        recorded: Version.of(whole, Option.some('a')),
        replayed: Version.of(whole, Option.some('b')),
        changed: [],
      }),
    );
  });

  it('names the components whose schemas changed', () => {
    const found = Version.mismatch(
      Version.of(whole, Option.some('a')),
      Version.of(halving, Option.some('b')),
    );
    expect(Option.map(found, ({ changed }) => changed)).toEqual(Option.some(['Health']));
  });

  it('tells two unnamed builds apart by their schemas alone', () => {
    expect(
      Version.mismatch(Version.of(whole, Option.none()), Version.of(whole, Option.none())),
    ).toEqual(Option.none());
    expect(
      Option.isSome(
        Version.mismatch(Version.of(whole, Option.none()), Version.of(halving, Option.none())),
      ),
    ).toBe(true);
  });
});

describe('Version.told', () => {
  it('says what recorded and what replays, and what changed', () => {
    const found = Version.mismatch(
      Version.of(whole, Option.some('a')),
      Version.of(halving, Option.none()),
    );
    expect(Option.map(found, Version.told)).toEqual(
      Option.some('recorded by build a, replayed by an unnamed build (changed components: Health)'),
    );
  });
});

describe('Version', () => {
  it('travels as JSON and back', () => {
    const version = Version.of(whole, Option.some('a'));
    const json = Schema.fromJsonString(Version.Version);
    expect(Schema.decodeSync(json)(Schema.encodeSync(json)(version))).toEqual(version);
  });
});
