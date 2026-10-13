import { describe, expect, it } from '@effect/vitest';
import { Effect, Option, Schema } from 'effect';
import * as Command from '#src/Command.ts';
import * as Component from '#src/Component.ts';
import * as Domain from '#src/Domain.ts';
import {
  Bitten,
  Controls,
  fixture,
  Fixture,
  Died,
  Health,
  Position,
  ChoseRestart,
} from '#src/fixtures.ts';
import * as Game from '#src/Game.ts';
import * as Rule from '#src/Rule.ts';
import * as Story from '#src/Story.ts';
import * as System from '#src/System.ts';
import * as State from '#src/State.ts';

/** Moves every controlled entity by its stick, at 10 a second. */
const steer = System.make({
  name: 'steer',
  reads: [Controls],
  writes: [Position],
  emits: [],
  run: (context) => {
    for (const [entity, position, controls] of context.query(Position, Controls)) {
      context.set(entity, Position, {
        x: position.x + controls.move * 10 * context.time.secondsPerStep,
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
  reads: [],
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
  reads: [],
  writes: [Health],
  emits: [],
  run: (context, restarted) => {
    context.set(restarted.player, Health, { current: 100 });
  },
});

const game = Game.only(fixture, { systems: [steer, bite], rules: [takeBite, restart] });

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
      Story.demand('her', Controls, { move: 1, fire: false }),
      Story.step(),
      Story.expect('her', Position, (position) => expect(position.x).toBe(1)),
    );
  });

  it('keeps a demand in the state after the step it reached', () => {
    Story.story(
      game,
      Story.spawn('her', her),
      Story.demand('her', Controls, { move: 1, fire: false }),
      Story.steps(3),
      Story.expect('her', Position, (position) => expect(position.x).toBe(3)),
    );
  });

  it('runs as many steps as some seconds take at the game’s rate', () => {
    Story.story(
      game,
      Story.spawn('her', her),
      Story.demand('her', Controls, { move: 1, fire: false }),
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

  it('starts from a state it is given, and reads it as a whole', () => {
    const [state, runner] = State.spawn(State.empty({ seed: 3 }), [Position.of({ x: 7 })]);

    Story.story(
      game,
      Story.given(state),
      Story.expectState((current) =>
        expect(State.get(current, runner, Position)).toEqual(Option.some({ x: 7 })),
      ),
    );
  });

  it('names the entities of a state it is given', () => {
    const [state, runner] = State.spawn(State.empty({ seed: 3 }), [Position.of({ x: 7 })]);

    Story.story(
      game,
      Story.given(state, { runner }),
      Story.expect('runner', Position, (position) => expect(position.x).toBe(7)),
    );
  });

  it('has an event happen at the next step, for the rules that handle it', () => {
    Story.story(
      game,
      Story.spawn('her', her),
      Story.happen(Bitten, { entity: 0, damage: 20 }),
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

  it('expects a whole value, compared as its schema encodes it', () => {
    Story.story(game, Story.spawn('her', her), Story.expectEqual('her', Health, { current: 50 }));

    expect(() =>
      Story.story(game, Story.spawn('her', her), Story.expectEqual('her', Health, { current: 1 })),
    ).toThrow('her holds Health {"current":50}, not {"current":1}');
  });

  it('steps until something comes to pass, and fails if it never does within a limit', () => {
    const walked = Story.story(
      game,
      Story.spawn('her', her),
      Story.demand('her', Controls, { move: 1, fire: false }),
      Story.until((state, named) =>
        Option.exists(State.get(state, named('her'), Position), ({ x }) => x >= 4),
      ),
    );

    expect(walked.state.tick).toBe(4);
    expect(() =>
      Story.story(
        game,
        Story.spawn('her', her),
        Story.until(() => false, { limit: 10 }),
      ),
    ).toThrow('it did not come to pass within 10 steps');
  });

  it('gives what a named entity holds where a story ended, for comparing one story with another', () => {
    const walk = (move: number) =>
      Story.valueOf(
        Story.story(
          game,
          Story.spawn('her', her),
          Story.demand('her', Controls, { move, fire: false }),
          Story.steps(5),
        ),
        'her',
        Position,
      );

    expect(walk(1).x).toBeGreaterThan(walk(0.5).x);
    expect(() => Story.valueOf(Story.story(game), 'her', Position)).toThrow(
      'no entity is named her',
    );
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

describe('Story, told by name', () => {
  /** A state with her in it, as the game's schema encodes it. */
  const encoded = Schema.encodeSync(Game.schema(game))(
    State.spawn(State.empty({ seed: 3 }), her)[0],
  );

  it('starts from a state as it travels, and plays it by names and values as they travel', () => {
    Story.story(
      game,
      Story.givenAs(encoded, { her: 0 }),
      Story.demandAs('her', 'Controls', { move: 1, fire: false }),
      Story.actAs('her', { _tag: 'ChoseRestart', x: 0 }),
      Story.step(),
      Story.expectAs('her', 'Position', { x: 1 }),
      Story.expectAs('her', 'Health', { current: 100 }),
      Story.expectAs('her', 'Controls', { fire: false, move: 1 }),
    );
  });

  it('has a command’s result arrive among the actions as it travels, and no event pass for one', () => {
    const Mended = Command.result('Mended', { entity: Schema.Int });
    const Mend = Command.make('Mend', {
      args: {},
      results: [Mended],
      execute: () => Effect.die('a story never runs a command'),
    });
    const Whole = Component.make('Whole', Schema.Struct({}), { owner: 'rules', network: 'server' });
    const mending = Game.make({
      stepRate: 10,
      domains: [
        Fixture,
        Domain.make({
          name: 'Mending',
          requires: [Fixture],
          components: [Whole],
          actions: [],
          events: [],
          commands: [Mend],
          systems: [],
          rules: [
            Rule.on(Mended, {
              reads: [],
              writes: [Whole],
              emits: [],
              run: (context, { entity }) => context.set(entity, Whole, {}),
            }),
          ],
        }),
      ],
    });

    const { events } = Story.story(
      mending,
      Story.spawn('her', her),
      Story.resolveAs({ _tag: 'Mended', entity: 0 }),
      Story.step(),
      Story.expectAs('her', 'Whole', {}),
    );
    expect(events).toEqual([]);
    expect(() =>
      Story.story(mending, Story.resolveAs({ _tag: 'Bitten', entity: 0, damage: 1 })),
    ).toThrow("Bitten is no result of the game's commands");
  });

  it('has an event happen as it travels, as if something had emitted it', () => {
    Story.story(
      game,
      Story.givenAs(encoded, { her: 0 }),
      Story.happenAs({ _tag: 'Bitten', entity: 0, damage: 20 }),
      Story.step(),
      Story.expectAs('her', 'Health', { current: 30 }),
      Story.expectNoneAs('her', 'Splat'),
    );
  });

  it('says plainly what it cannot read', () => {
    const told = (step: Story.Line) => () =>
      Story.story(game, Story.givenAs(encoded, { her: 0 }), step);

    expect(told(Story.demandAs('her', 'Health', { current: 1 }))).toThrow(
      'Health is no demand of the game',
    );
    expect(told(Story.demandAs('her', 'Controls', { move: 'far' }))).toThrow('Controls');
    expect(told(Story.actAs('her', { _tag: 'Flew' }))).toThrow(
      'Flew is no action a player of the game takes',
    );
    expect(told(Story.happenAs({ _tag: 'Flew' }))).toThrow('Flew is no event of the game');
    expect(told(Story.expectAs('her', 'Health', { current: 1 }))).toThrow(
      'her holds Health {"current":50}, not {"current":1}',
    );
    expect(told(Story.expectAs('her', 'Wings', {}))).toThrow('Wings is no component of the game');
    expect(() => Story.story(game, Story.givenAs({ tick: 'soon' }))).toThrow(
      'not a state of the game',
    );
  });
});
