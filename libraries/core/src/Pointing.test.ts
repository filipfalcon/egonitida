import { describe, it } from '@effect/vitest';
import { Option, Schema } from 'effect';
import * as Component from '#src/Component.ts';
import * as Domain from '#src/Domain.ts';
import * as Game from '#src/Game.ts';
import * as Pointing from '#src/Pointing.ts';
import * as Rule from '#src/Rule.ts';
import * as Story from '#src/Story.ts';

/** A lamp that a click turns on. */
const Lamp = Component.make('Lamp', Schema.Struct({ lit: Schema.Boolean }), {
  owner: 'rules',
  network: 'server',
});

const lighting = Domain.make({
  name: 'Lighting',
  requires: [Pointing.domain],
  components: [Lamp],
  actions: [],
  events: [],
  systems: [],
  rules: [
    Rule.on(Pointing.Clicked, {
      reads: [],
      writes: [Lamp],
      emits: [],
      run: (context, { entity }) => {
        Option.map(context.get(entity, Lamp), () => context.set(entity, Lamp, { lit: true }));
      },
    }),
  ],
});

const game = Game.make({ stepRate: 10, domains: [Pointing.domain, lighting] });

describe('pointing', () => {
  it('hands a click on an entity to the rules, as from the player who clicked', () => {
    Story.story(
      game,
      Story.spawn('lamp', [Lamp.of({ lit: false }), Pointing.Label.of({ text: 'Desk lamp' })]),
      Story.spawn('player', []),
      // The lamp is the first entity spawned.
      Story.act('player', Pointing.Clicked, { entity: 0 }),
      Story.step(),
      Story.expectEqual('lamp', Lamp, { lit: true }),
    );
  });

  it('labels what can be clicked, by what it is read out as', () => {
    Story.story(
      game,
      Story.spawn('lamp', [Lamp.of({ lit: false }), Pointing.Label.of({ text: 'Desk lamp' })]),
      Story.expectEqual('lamp', Pointing.Label, { text: 'Desk lamp' }),
    );
  });

  it('reads an entity out by a new label once it is relabelled, and leaves one with no label without', () => {
    Story.story(
      game,
      Story.spawn('lamp', [Lamp.of({ lit: false }), Pointing.Label.of({ text: 'Desk lamp' })]),
      Story.spawn('chair', [Lamp.of({ lit: false })]),
      // The lamp is the first entity spawned, the chair the second.
      Story.happen(Pointing.Relabelled, { entity: 0, text: 'Reading lamp' }),
      Story.happen(Pointing.Relabelled, { entity: 1, text: 'Chair' }),
      Story.step(),
      Story.expectEqual('lamp', Pointing.Label, { text: 'Reading lamp' }),
      Story.expectNone('chair', Pointing.Label),
    );
  });
});
