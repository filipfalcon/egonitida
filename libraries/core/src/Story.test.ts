import { describe, expect, it } from '@effect/vitest';
import { Option } from 'effect';
import { Bitten, Controls, declared, Died, Health, Position, ChoseRestart } from '#src/fixtures.ts';
import * as Game from '#src/Game.ts';
import * as Rule from '#src/Rule.ts';
import * as Story from '#src/Story.ts';
import * as System from '#src/System.ts';
import * as World from '#src/World.ts';

/** Moves every controlled entity by its stick, at 10 a second. */
const steer = System.make({
  name: 'steer',
  reads: [Controls],
  writes: [Position],
  emits: [],
  run: (context) => {
    for (const [entity, position, controls] of context.query(Position, Controls)) {
      context.set(entity, Position, {
        x: position.x + controls.move * 10 * context.time.stepSeconds,
      });
    }
  },
});

/** Bites everything with health that stands at or past x = 10. */
const bite = System.make({
  name: 'bite',
  reads: [Position, Health],
  writes: [],
  emits: [Bitten],
  run: (context) => {
    for (const [entity, position] of context.query(Position, Health)) {
      if (position.x >= 10) {
        context.emit({ _tag: 'Bitten', entity, damage: 30 });
      }
    }
  },
});

const takeBite = Rule.on(Bitten, {
  writes: [Health],
  emits: [],
  run: (context, bitten) => {
    Option.map(context.get(bitten.entity, Health), ({ current }) =>
      context.set(bitten.entity, Health, { current: current - bitten.damage }),
    );
  },
});

/** A player who restarts is healed whole. */
const restart = Rule.on(ChoseRestart, {
  writes: [Health],
  emits: [],
  run: (context, restarted) => {
    context.set(restarted.player, Health, { current: 100 });
  },
});

const game = Game.make({
  stepRate: 10,
  ...declared,
  systems: [steer, bite],
  rules: [takeBite, restart],
});

const her = [
  Position.of({ x: 0 }),
  Controls.of({ move: 0, fire: false }),
  Health.of({ current: 50 }),
];

describe('Story', () => {
  it('spawns entities by name, steps, and expects what they hold', () => {
    Story.story(
      game,
      Story.spawn('her', her),
      Story.input('her', Controls, { move: 1, fire: false }),
      Story.step(),
      Story.expect('her', Position, (position) => expect(position.x).toBe(1)),
    );
  });

  it('keeps an input in the world after the step it reached', () => {
    Story.story(
      game,
      Story.spawn('her', her),
      Story.input('her', Controls, { move: 1, fire: false }),
      Story.steps(3),
      Story.expect('her', Position, (position) => expect(position.x).toBe(3)),
    );
  });

  it('runs as many steps as some seconds take at the game’s rate', () => {
    Story.story(
      game,
      Story.spawn('her', her),
      Story.input('her', Controls, { move: 1, fire: false }),
      Story.seconds(0.5),
      Story.expect('her', Position, (position) => expect(position.x).toBe(5)),
    );
  });

  it('takes an action as from the player it names, at the next step', () => {
    Story.story(
      game,
      Story.spawn('her', her),
      Story.act('her', ChoseRestart, { x: 0 }),
      Story.expect('her', Health, (health) => expect(health.current).toBe(50)),
      Story.step(),
      Story.expect('her', Health, (health) => expect(health.current).toBe(100)),
    );
  });

  it('expects the events of the steps it last ran, and their values', () => {
    Story.story(
      game,
      Story.spawn('her', [Position.of({ x: 10 }), Health.of({ current: 50 })]),
      Story.step(),
      Story.expectEvent(Bitten, (bites) => expect(bites.map(({ damage }) => damage)).toEqual([30])),
      Story.expectNoEvent(Died),
    );
  });

  it('starts from a world it is given, and reads it as a whole', () => {
    const [world, runner] = World.spawn(World.empty({ seed: 3 }), [Position.of({ x: 7 })]);

    Story.story(
      game,
      Story.given(world),
      Story.world((current) =>
        expect(World.get(current, runner, Position)).toEqual(Option.some({ x: 7 })),
      ),
    );
  });

  it('names the entities of a world it is given', () => {
    const [world, runner] = World.spawn(World.empty({ seed: 3 }), [Position.of({ x: 7 })]);

    Story.story(
      game,
      Story.given(world, { runner }),
      Story.expect('runner', Position, (position) => expect(position.x).toBe(7)),
    );
  });

  it('has an event happen at the next step, for the rules that handle it', () => {
    Story.story(
      game,
      Story.spawn('her', her),
      Story.happen(Bitten, { _tag: 'Bitten', entity: 0, damage: 20 }),
      Story.step(),
      Story.expect('her', Health, (health) => expect(health.current).toBe(30)),
      Story.expectEvent(Bitten),
    );
  });

  it('expects an entity not to hold a component', () => {
    Story.story(game, Story.spawn('her', [Position.of({ x: 0 })]), Story.expectNone('her', Health));

    expect(() =>
      Story.story(game, Story.spawn('her', her), Story.expectNone('her', Health)),
    ).toThrow('her holds Health');
  });

  it('fails a story whose expectation does not hold', () => {
    expect(() =>
      Story.story(
        game,
        Story.spawn('her', [Position.of({ x: 0 })]),
        Story.expect('her', Health, () => {}),
      ),
    ).toThrow('her holds no Health');
    expect(() =>
      Story.story(
        game,
        Story.expect('nobody', Health, () => {}),
      ),
    ).toThrow('no entity is named nobody');
    expect(() => Story.story(game, Story.step(), Story.expectEvent(Bitten))).toThrow(
      'no Bitten happened',
    );
    expect(() =>
      Story.story(
        game,
        Story.spawn('her', [Position.of({ x: 10 }), Health.of({ current: 50 })]),
        Story.step(),
        Story.expectNoEvent(Bitten),
      ),
    ).toThrow('Bitten happened');
  });
});
