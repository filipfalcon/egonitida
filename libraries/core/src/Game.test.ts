import { describe, expect, it } from '@effect/vitest';
import { Effect, Option, Schema } from 'effect';
import * as Action from '#src/Action.ts';
import * as Command from '#src/Command.ts';
import * as Component from '#src/Component.ts';
import * as Event from '#src/Event.ts';
import {
  Bitten,
  Controls,
  Died,
  Fixture,
  fixture,
  Health,
  Position,
  ChoseRestart,
  Splat,
  Velocity,
  Wall,
} from '#src/fixtures.ts';
import * as Game from '#src/Game.ts';
import * as Input from '#src/Input.ts';
import * as Domain from '#src/Domain.ts';
import * as Rule from '#src/Rule.ts';
import * as Story from '#src/Story.ts';
import * as Snapshot from '#src/Snapshot.ts';
import * as System from '#src/System.ts';
import * as World from '#src/World.ts';

// SYSTEMS: what changes every step.

const move = System.make({
  name: 'move',
  reads: [Velocity],
  writes: [Position],
  emits: [],
  run: (context) => {
    for (const [entity, position, velocity] of context.query(Position, Velocity)) {
      context.set(entity, Position, { x: position.x + velocity.x * context.time.stepSeconds });
    }
  },
});

/** Bites every entity with health that stands at or past the zombie at x = 10. */
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

// RULES: what the game decides.

const takeBite = Rule.on(Bitten, {
  writes: [Health],
  emits: [Died],
  run: (context, bitten) => {
    const health = Option.getOrElse(context.get(bitten.entity, Health), () => ({ current: 0 }));
    const current = health.current - bitten.damage;
    context.set(bitten.entity, Health, { current });
    if (current <= 0 && health.current > 0) {
      context.emit({ _tag: 'Died', entity: bitten.entity });
    }
  },
});

const game = Game.only(fixture, { systems: [move, bite], rules: [takeBite] });

/** A runner at `x`, running at 10 a second, with `health`. */
const runner = (x: number, health: number) => [
  Position.of({ x }),
  Velocity.of({ x: 10 }),
  Health.of({ current: health }),
];

const spawnRunner = (x: number, health: number) =>
  World.spawn(World.empty({ seed: 7 }), runner(x, health));

describe('Game.step', () => {
  it('advances the tick and runs the systems', () => {
    const [world, runner] = spawnRunner(0, 100);
    const after = Game.step(game, world).world;

    expect(after.tick).toBe(1);
    // 10 per second over a step of a tenth of a second.
    expect(World.get(after, runner, Position)).toEqual(Option.some({ x: 1 }));
  });

  it('runs the systems in order, each seeing what the ones before it wrote', () => {
    // The runner reaches x = 10 in this very step, so `bite`, running after `move`, already sees it there.
    Story.story(
      game,
      Story.spawn('runner', runner(9, 100)),
      Story.step(),
      Story.expect('runner', Health, (health) => expect(health.current).toBe(70)),
    );
  });

  it('applies events within the step that emitted them, one after another', () => {
    const doubleBite = System.make({
      name: 'doubleBite',
      reads: [Health],
      writes: [],
      emits: [Bitten],
      run: (context) => {
        for (const [entity] of context.query(Health)) {
          context.emit({ _tag: 'Bitten', entity, damage: 30 });
          context.emit({ _tag: 'Bitten', entity, damage: 30 });
        }
      },
    });
    const twice = Game.only(fixture, { systems: [doubleBite], rules: [takeBite] });

    // The second bite sees the health the first one left, so the runner dies exactly once.
    Story.story(
      twice,
      Story.spawn('runner', runner(0, 50)),
      Story.step(),
      Story.expect('runner', Health, (health) => expect(health.current).toBe(-10)),
      Story.expectEvent(Died, (deaths) => expect(deaths).toHaveLength(1)),
    );
  });

  it('reports every event of the step, in the order they happened', () => {
    const [world, runner] = spawnRunner(10, 30);

    expect(Game.step(game, world).events).toEqual([
      { _tag: 'Bitten', entity: runner, damage: 30 },
      { _tag: 'Died', entity: runner },
    ]);
  });

  it('leaves the world it was given untouched', () => {
    const [world, runner] = spawnRunner(0, 100);
    Game.step(game, world);

    expect(World.get(world, runner, Position)).toEqual(Option.some({ x: 0 }));
    expect(world.tick).toBe(0);
  });
});

/** A world's contents, written out component by component: what two worlds are compared by. Worlds are compared by what they hold, not by which objects hold it. */
const contents = Schema.encodeSync(Schema.fromJsonString(Game.schema(game)));

describe('determinism', () => {
  const scatter = System.make({
    name: 'scatter',
    reads: [],
    writes: [Position],
    emits: [],
    run: (context) => {
      for (const [entity, position] of context.query(Position)) {
        context.set(entity, Position, { x: position.x + context.random() });
      }
    },
  });
  const noisy = Game.only(fixture, { systems: [scatter], rules: [] });
  const run = (seed: number) => {
    const [start] = World.spawn(World.empty({ seed }), [Position.of({ x: 0 })]);
    return Array.from({ length: 20 }).reduce<World.World>(
      (world) => Game.step(noisy, world).world,
      start,
    );
  };

  it('reaches the same world from the same seed', () => {
    expect(contents(run(42))).toEqual(contents(run(42)));
  });

  it('reaches another world from another seed', () => {
    expect(contents(run(42))).not.toEqual(contents(run(43)));
  });

  it('draws randomness only from the world, in [0, 1)', () => {
    const draws = Array.from({ length: 1000 }, (_, index) =>
      World.query(run(index), Position).map(([, position]) => position.x),
    ).flat();

    expect(draws.every((x) => x >= 0 && x < 20)).toBe(true);
  });
});

describe('input', () => {
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
  const steered = Game.only(fixture, { systems: [steer], rules: [] });
  const [start, recorded] = World.spawn(World.empty({ seed: 1 }), [
    Position.of({ x: 0 }),
    Controls.of({ move: 0, fire: false }),
  ]);
  const push = (move: number) => [Input.of(recorded, Controls, { move, fire: false })];

  const player = [Position.of({ x: 0 }), Controls.of({ move: 0, fire: false })];

  it('reaches the systems in the step it is given to', () => {
    Story.story(
      steered,
      Story.spawn('her', player),
      Story.input('her', Controls, { move: 1, fire: false }),
      Story.step(),
      Story.expect('her', Position, (position) => expect(position.x).toBe(1)),
    );
  });

  it('stays as it was in a step given no new input, the way a held stick does', () => {
    Story.story(
      steered,
      Story.spawn('her', player),
      Story.input('her', Controls, { move: 1, fire: false }),
      Story.steps(2),
      Story.expect('her', Position, (position) => expect(position.x).toBe(2)),
    );
  });

  it('only reaches an entity spawned to accept it', () => {
    Story.story(
      steered,
      Story.spawn('bystander', [Position.of({ x: 5 })]),
      Story.input('bystander', Controls, { move: 1, fire: false }),
      Story.step(),
      Story.expectNone('bystander', Controls),
      Story.expect('bystander', Position, (position) => expect(position.x).toBe(5)),
    );
  });

  it('replays to the same world from the same start and the same inputs', () => {
    const recording = [push(1), [], push(-0.5), push(0.25), [], []];
    const play = () =>
      recording.reduce<World.World>(
        (world, inputs) => Game.step(steered, world, inputs).world,
        start,
      );

    expect(contents(play())).toEqual(contents(play()));
    // A held stick keeps moving: 1 + 1 - 0.5 + 0.25 + 0.25 + 0.25.
    expect(World.get(play(), recorded, Position)).toEqual(Option.some({ x: 2.25 }));
  });
});

describe('actions', () => {
  // The rules put a restarting player's health back, and a system that runs after sees it this very step.
  const restart = Rule.on(ChoseRestart, {
    writes: [Health],
    emits: [],
    run: (context, restarted) => {
      context.set(restarted.player, Health, { current: 100 });
    },
  });
  const seen: Array<number> = [];
  const look = System.make({
    name: 'look',
    reads: [Health],
    writes: [],
    emits: [],
    run: (context) => {
      for (const [, health] of context.query(Health)) {
        seen.push(health.current);
      }
    },
  });
  const restarting = Game.only(fixture, { systems: [look], rules: [restart] });
  const [world, player] = spawnRunner(0, 10);
  /** An action as the host hands it on: sent by a client, then accepted as from its player. */
  const restarted = (x: number) =>
    Option.getOrThrow(ChoseRestart.accept(ChoseRestart.encode({ x }), player));

  it('is handled by the rules within the step it arrives, before the systems run', () => {
    seen.length = 0;
    Story.story(
      restarting,
      Story.spawn('her', runner(0, 10)),
      Story.act('her', ChoseRestart, { x: 0 }),
      Story.step(),
      Story.expect('her', Health, (health) => expect(health.current).toBe(100)),
    );

    expect(seen).toEqual([100]);
  });

  it('is reported first among the step’s events, in the order the actions came', () => {
    const { events } = Game.step(restarting, world, [], [restarted(1), restarted(2)]);

    expect(events).toEqual([
      { _tag: 'ChoseRestart', x: 1, player },
      { _tag: 'ChoseRestart', x: 2, player },
    ]);
  });
});

describe('spawning and despawning within a step', () => {
  /** Raises a runner at x = 0 for every entity with health and no runner of its own yet: one per step here. */
  const raise = System.make({
    name: 'raise',
    reads: [Health, Velocity],
    writes: [],
    emits: [],
    spawns: [Position, Velocity],
    run: (context) => {
      if (context.query(Velocity).length === 0) {
        context.spawn([Position.of({ x: 0 }), Velocity.of({ x: 10 })]);
      }
    },
  });
  /** Removes anything that has run past x = 1. */
  const remove = System.make({
    name: 'remove',
    reads: [Position],
    writes: [],
    emits: [],
    despawns: true,
    run: (context) => {
      for (const [entity, position] of context.query(Position)) {
        if (position.x > 1) {
          context.despawn(entity);
        }
      }
    },
  });
  const [world, keeper] = World.spawn(World.empty({ seed: 3 }), [Health.of({ current: 1 })]);

  it('gives the spawned entity the next id, and later systems see it in the same step', () => {
    const lifecycle = Game.only(fixture, { systems: [raise, move], rules: [] });
    const after = Game.step(lifecycle, world).world;
    const runner = keeper + 1;

    // `move`, running after `raise`, already moved it by a step.
    expect(World.get(after, runner, Position)).toEqual(Option.some({ x: 1 }));
    expect(after.nextEntity).toBe(runner + 1);
  });

  it('takes a despawned entity out of every store at once, so later systems no longer see it', () => {
    const lifecycle = Game.only(fixture, { systems: [raise, move, move, remove, move], rules: [] });
    const after = Game.step(lifecycle, world).world;
    const runner = keeper + 1;

    // Moved twice to x = 2, removed, and not moved a third time.
    expect(World.get(after, runner, Position)).toEqual(Option.none());
    expect(World.get(after, runner, Velocity)).toEqual(Option.none());
    // Its id is never given out again.
    expect(after.nextEntity).toBe(runner + 1);
  });

  it('lets the rules spawn and despawn in answer to an event', () => {
    const replace = Rule.on(Died, {
      writes: [],
      emits: [],
      spawns: [Health],
      despawns: true,
      run: (context, died) => {
        context.despawn(died.entity);
        context.spawn([Health.of({ current: 100 })]);
      },
    });
    const replacing = Game.only(fixture, { systems: [bite], rules: [takeBite, replace] });
    Story.story(
      replacing,
      Story.spawn('runner', runner(10, 30)),
      Story.step(),
      Story.expectNone('runner', Health),
      Story.world((after, named) =>
        expect(World.get(after, named('runner') + 1, Health)).toEqual(
          Option.some({ current: 100 }),
        ),
      ),
    );
  });

  it('leaves the world it was given untouched', () => {
    const lifecycle = Game.only(fixture, { systems: [raise, move, move, remove], rules: [] });
    Game.step(lifecycle, world);

    expect(world.nextEntity).toBe(keeper + 1);
    expect(World.query(world, Position)).toEqual([]);
  });

  it('replays to the same world, ids and all', () => {
    const lifecycle = Game.only(fixture, { systems: [raise, move, remove], rules: [] });
    const play = () =>
      Array.from({ length: 12 }).reduce<World.World>(
        (current) => Game.step(lifecycle, current).world,
        world,
      );

    expect(contents(play())).toEqual(contents(play()));
    expect(play().nextEntity).toBe(play().nextEntity);
  });
});

describe('tracing a step', () => {
  const part = (name: string): Game.Part => ({ _tag: 'System', name, domain: Option.none() });
  const nothing = { set: [], spawned: [], despawned: [], emitted: [], issued: [] };

  it('tells what each system and rule did in it, a rule with the event it ran for', () => {
    const [world, runner] = spawnRunner(9, 30);
    const bitten = { _tag: 'Bitten', entity: runner, damage: 30 };

    expect(Game.step(game, world, [], [], { trace: true }).trace).toEqual([
      {
        ...nothing,
        part: part('move'),
        cause: Option.none(),
        set: [{ entity: runner, component: 'Position' }],
      },
      { ...nothing, part: part('bite'), cause: Option.none(), emitted: [bitten] },
      {
        ...nothing,
        part: { _tag: 'Rule', on: 'Bitten', name: Option.none(), domain: Option.none() },
        cause: Option.some(bitten),
        set: [{ entity: runner, component: 'Health' }],
        emitted: [{ _tag: 'Died', entity: runner }],
      },
    ]);
  });

  it('leaves out what did nothing, and tells what was spawned and despawned', () => {
    const raise = System.make({
      name: 'raise',
      reads: [],
      writes: [],
      emits: [],
      spawns: [Position],
      run: (context) => {
        context.spawn([Position.of({ x: 5 })]);
      },
    });
    const clear = System.make({
      name: 'clear',
      reads: [Position],
      writes: [],
      emits: [],
      despawns: true,
      run: (context) => {
        for (const [entity, position] of context.query(Position)) {
          if (position.x === 0) {
            context.despawn(entity);
          }
        }
      },
    });
    const [world, standing] = World.spawn(World.empty({ seed: 1 }), [Position.of({ x: 0 })]);
    const lifecycle = Game.only(fixture, { systems: [raise, move, clear], rules: [] });

    expect(Game.step(lifecycle, world, [], [], { trace: true }).trace).toEqual([
      { ...nothing, part: part('raise'), cause: Option.none(), spawned: [standing + 1] },
      { ...nothing, part: part('clear'), cause: Option.none(), despawned: [standing] },
    ]);
  });

  it('tells a value set twice by the same part once', () => {
    const twice = System.make({
      name: 'twice',
      reads: [],
      writes: [Position],
      emits: [],
      run: (context) => {
        for (const [entity] of context.query(Position)) {
          context.set(entity, Position, { x: 1 });
          context.set(entity, Position, { x: 2 });
        }
      },
    });
    const [world, entity] = World.spawn(World.empty({ seed: 1 }), [Position.of({ x: 0 })]);

    expect(
      Game.step(Game.only(fixture, { systems: [twice], rules: [] }), world, [], [], {
        trace: true,
      }).trace,
    ).toEqual([
      {
        ...nothing,
        part: part('twice'),
        cause: Option.none(),
        set: [{ entity, component: 'Position' }],
      },
    ]);
  });

  it('traces nothing unless asked to', () => {
    const [world] = spawnRunner(9, 30);

    expect(Game.step(game, world).trace).toEqual([]);
  });
});

describe('Game.changes', () => {
  const changes = Game.changes(game);

  it('tells which systems read, write, and spawn each component, and which rules write it', () => {
    expect(changes.components.get('Position')).toEqual({
      readBy: [{ _tag: 'System', name: 'bite', domain: Option.none() }],
      writtenBy: [{ _tag: 'System', name: 'move', domain: Option.none() }],
      spawnedBy: [],
    });
    expect(changes.components.get('Health')?.writtenBy).toEqual([
      { _tag: 'Rule', on: 'Bitten', name: Option.none(), domain: Option.none() },
    ]);
  });

  it('tells what emits each event and what handles it, actions included', () => {
    expect(changes.events.get('Bitten')).toEqual({
      emittedBy: [{ _tag: 'System', name: 'bite', domain: Option.none() }],
      handledBy: [{ _tag: 'Rule', on: 'Bitten', name: Option.none(), domain: Option.none() }],
    });
    expect(changes.events.get('Died')).toEqual({
      emittedBy: [{ _tag: 'Rule', on: 'Bitten', name: Option.none(), domain: Option.none() }],
      handledBy: [],
    });
    expect(changes.events.get('ChoseRestart')).toEqual({ emittedBy: [], handledBy: [] });
  });

  it('lists every component and event the game declares, even those nothing touches', () => {
    expect([...changes.components.keys()]).toEqual(game.components.map(({ name }) => name));
    expect([...changes.events.keys()]).toEqual(['ChoseRestart', 'Bitten', 'Died']);
    expect(changes.components.get('Wall')).toEqual({ readBy: [], writtenBy: [], spawnedBy: [] });
  });

  it('tells which domain each part belongs to, and a rule by its name', () => {
    const Owned = Component.make('Owned', Schema.Struct({ x: Schema.Finite }), {
      owner: 'rules',
      network: 'server',
    });
    const keeping = Rule.on(Died, { name: 'keep', writes: [Owned], emits: [], run: () => {} });
    const Keeper = Domain.make({
      name: 'Keeper',
      requires: [Fixture],
      components: [Owned],
      actions: [],
      events: [],
      systems: [],
      rules: [keeping],
    });
    const handled = Game.changes(Game.make({ stepRate: 10, domains: [Fixture, Keeper] })).events;

    expect(handled.get('Died')?.handledBy).toEqual([
      { _tag: 'Rule', on: 'Died', name: Option.some('keep'), domain: Option.some('Keeper') },
    ]);
    expect(handled.get('Bitten')?.handledBy).toEqual([
      { _tag: 'Rule', on: 'Bitten', name: Option.none(), domain: Option.some('Fixture') },
    ]);
  });

  it('tells what may despawn', () => {
    const removing = Game.only(fixture, {
      systems: [
        System.make({
          name: 'sweep',
          reads: [],
          writes: [],
          emits: [],
          despawns: true,
          run: () => {},
        }),
      ],
      rules: [],
    });

    expect(Game.changes(removing).despawnedBy).toEqual([
      { _tag: 'System', name: 'sweep', domain: Option.none() },
    ]);
  });
});

describe('in development', () => {
  /** Moves every runner by changing its position in place, as no system may. */
  const shove = System.make({
    name: 'shove',
    reads: [],
    writes: [Position],
    emits: [],
    run: (context) => {
      for (const [, position] of context.query(Position)) {
        Object.assign(position, { x: position.x + 1 });
      }
    },
  });
  const shoving = Game.only(fixture, { systems: [shove], rules: [] });

  it('freezes what a step leaves, so changing it in place fails at once', () => {
    const [world] = spawnRunner(0, 100);
    const once = Game.step(game, world, [], [], { freeze: true }).world;

    expect(() => Game.step(shoving, once, [], [], { freeze: true })).toThrow(TypeError);
  });

  it('freezes what a world was spawned with, from the first step on', () => {
    const [world] = spawnRunner(0, 100);

    expect(() => Game.step(shoving, world, [], [], { freeze: true })).toThrow(TypeError);
  });

  it('freezes in every story', () => {
    expect(() =>
      Story.story(shoving, Story.spawn('runner', runner(0, 100)), Story.steps(2)),
    ).toThrow(TypeError);
  });
});

// What the type checker refuses: each line below must stay a compile error, or `vp check` fails on the unused directive.
export const refused = () => {
  System.make({
    name: 'writesTheRules',
    reads: [],
    // @ts-expect-error Health belongs to the rules; a system cannot write it.
    writes: [Health],
    emits: [],
    run: () => {},
  });

  System.make({
    name: 'writesUndeclared',
    reads: [Position],
    writes: [],
    emits: [],
    run: (context) => {
      // @ts-expect-error Position is read here, not written.
      context.set(0, Position, { x: 1 });
    },
  });

  System.make({
    name: 'readsUndeclared',
    reads: [],
    writes: [],
    emits: [],
    run: (context) => {
      // @ts-expect-error Velocity is not declared.
      context.query(Velocity);
    },
  });

  System.make({
    name: 'emitsUndeclared',
    reads: [],
    writes: [],
    emits: [],
    run: (context) => {
      // @ts-expect-error Died is not declared.
      context.emit({ _tag: 'Died', entity: 0 });
    },
  });

  System.make({
    name: 'writesTheInput',
    reads: [],
    // @ts-expect-error Controls belong to the input; only the engine writes them, from what players send.
    writes: [Controls],
    emits: [],
    run: () => {},
  });

  System.make({
    name: 'spawnsUndeclared',
    reads: [],
    writes: [],
    emits: [],
    spawns: [Position],
    run: (context) => {
      // @ts-expect-error Health is not among what this system spawns.
      context.spawn([Health.of({ current: 1 })]);
    },
  });

  System.make({
    name: 'despawnsUndeclared',
    reads: [],
    writes: [],
    emits: [],
    run: (context) => {
      // @ts-expect-error Despawning is not declared.
      context.despawn(0);
    },
  });

  Rule.on(Bitten, {
    writes: [],
    emits: [],
    run: (context) => {
      // @ts-expect-error Spawning is not declared.
      context.spawn([Health.of({ current: 1 })]);
    },
  });

  // @ts-expect-error Position is not input; no player can send it.
  Input.of(0, Position, { x: 1 });

  Rule.on(Bitten, {
    // @ts-expect-error Position belongs to the simulation; a rule cannot write it.
    writes: [Position],
    emits: [],
    run: () => {},
  });
};

describe('Domain.make', () => {
  const Owned = Component.make('Owned', Schema.Struct({ x: Schema.Finite }), {
    owner: 'simulation',
    network: 'server',
  });
  /** Noticed, like Owned, belongs to a domain of its own, which not every domain requires. */
  const Noticed = Event.make('Noticed', {});
  it('lets a domain read, spawn, emit, and handle what the domains it requires declare', () => {
    const watching = System.make({
      name: 'watching',
      reads: [Position],
      writes: [Owned],
      emits: [Bitten],
      spawns: [Health, Owned],
      run: () => {},
    });
    const answering = Rule.on(Died, { writes: [], emits: [Noticed], run: () => {} });
    const Watcher = Domain.make({
      name: 'Watcher',
      requires: [Fixture],
      components: [Owned],
      actions: [],
      events: [Noticed],
      systems: [watching],
      rules: [answering],
    });

    expect(Game.make({ stepRate: 10, domains: [Fixture, Watcher] }).systems).toEqual([watching]);
  });

  it('refuses a domain writing what another domain owns, even one it requires', () => {
    const meddling = System.make({
      name: 'meddling',
      reads: [],
      writes: [Position],
      emits: [],
      run: () => {},
    });
    const overruling = Rule.on(Died, { writes: [Health], emits: [], run: () => {} });

    Domain.make({
      name: 'Meddler',
      requires: [Fixture],
      components: [],
      actions: [],
      events: [],
      // @ts-expect-error Position is the fixture's to write.
      systems: [meddling],
      rules: [],
    });
    Domain.make({
      name: 'Overruler',
      requires: [Fixture],
      components: [],
      actions: [],
      events: [],
      systems: [],
      // @ts-expect-error Health is the fixture's to write.
      rules: [overruling],
    });
  });

  it('lets a domain write what a domain it requires shares, and nothing else of it', () => {
    const Moved = Component.make('Moved', Schema.Struct({ x: Schema.Finite }), {
      owner: 'simulation',
      network: 'server',
    });
    const Kept = Component.make('Kept', Schema.Struct({ x: Schema.Finite }), {
      owner: 'simulation',
      network: 'server',
    });
    const Bodies = Domain.make({
      name: 'Bodies',
      requires: [],
      components: [Moved, Kept],
      shares: [Moved],
      actions: [],
      events: [],
      systems: [],
      rules: [],
    });
    const pushing = System.make({
      name: 'pushing',
      reads: [],
      writes: [Moved],
      emits: [],
      run: () => {},
    });
    const keeping = System.make({
      name: 'keeping',
      reads: [],
      writes: [Kept],
      emits: [],
      run: () => {},
    });
    const parts = {
      requires: [Bodies],
      components: [],
      actions: [],
      events: [],
      rules: [],
    } as const;
    const Pusher = Domain.make({ ...parts, name: 'Pusher', systems: [pushing] });

    expect(Game.make({ stepRate: 10, domains: [Bodies, Pusher] }).systems).toEqual([pushing]);
    // @ts-expect-error Kept is not shared.
    Domain.make({ ...parts, name: 'Keeper', systems: [keeping] });
  });

  it('refuses a domain sharing what it does not own', () => {
    Domain.make({
      name: 'Generous',
      requires: [Fixture],
      components: [],
      // @ts-expect-error Position is the fixture's, not the generous domain's.
      shares: [Position],
      actions: [],
      events: [],
      systems: [],
      rules: [],
    });
  });

  it('refuses a domain reading, emitting, or handling what a domain it does not require declares', () => {
    const reading = System.make({
      name: 'reading',
      reads: [Owned],
      writes: [],
      emits: [],
      run: () => {},
    });
    const emitting = System.make({
      name: 'emitting',
      reads: [],
      writes: [],
      emits: [Noticed],
      run: () => {},
    });
    const handling = Rule.on(Noticed, { writes: [], emits: [], run: () => {} });
    const parts = {
      name: 'Stranger',
      requires: [Fixture],
      components: [],
      actions: [],
      events: [],
    } as const;

    // @ts-expect-error Owned is not the stranger's, nor of a domain it requires.
    Domain.make({ ...parts, systems: [reading], rules: [] });
    // @ts-expect-error Noticed is not the stranger's, nor of a domain it requires.
    Domain.make({ ...parts, systems: [emitting], rules: [] });
    // @ts-expect-error Noticed is not the stranger's, nor of a domain it requires.
    Domain.make({ ...parts, systems: [], rules: [handling] });
  });
});

describe('Game.make', () => {
  const Owned = Component.make('Owned', Schema.Struct({ x: Schema.Finite }), {
    owner: 'simulation',
    network: 'server',
  });
  const Needy = Domain.make({
    name: 'Needy',
    requires: [Fixture],
    components: [Owned],
    actions: [],
    events: [],
    systems: [],
    rules: [],
  });

  it('is made of its domains, their parts in the order the domains come', () => {
    const made = Game.make({ stepRate: 10, domains: [Fixture, Needy] });

    expect(made.components.map(({ name }) => name)).toEqual([
      'Position',
      'Velocity',
      'Health',
      'Controls',
      'Splat',
      'Wall',
      'Owned',
    ]);
    expect(made.actions.map(({ tag }) => tag)).toEqual(['ChoseRestart']);
    expect(made.events.map(({ tag }) => tag)).toEqual(['Bitten', 'Died']);
  });

  it('refuses an action no rule answers, and an event nothing emits or handles', () => {
    const Pressed = Action.make('Pressed', {});
    const Forgotten = Event.make('Forgotten', {});
    const parts = { requires: [], components: [], systems: [], rules: [] } as const;
    const Mute = Domain.make({ ...parts, name: 'Mute', actions: [Pressed], events: [] });
    const Haunted = Domain.make({ ...parts, name: 'Haunted', actions: [], events: [Forgotten] });

    // @ts-expect-error Pressed is a player doing something to no effect.
    Game.make({ stepRate: 10, domains: [Mute] });
    // @ts-expect-error Forgotten is never emitted and never handled.
    Game.make({ stepRate: 10, domains: [Haunted] });
  });

  it('lets an event go unanswered, as a domain’s offer to others', () => {
    const Called = Event.make('Called', {});
    const calling = System.make({
      name: 'calling',
      reads: [],
      writes: [],
      emits: [Called],
      run: () => {},
    });
    const Caller = Domain.make({
      name: 'Caller',
      requires: [],
      components: [],
      actions: [],
      events: [Called],
      systems: [calling],
      rules: [],
    });

    expect(Game.make({ stepRate: 10, domains: [Caller] }).events).toEqual([Called]);
  });

  it('refuses a game missing a domain one of its domains requires', () => {
    // @ts-expect-error Needy requires the fixture's domain.
    Game.make({ stepRate: 10, domains: [Needy] });
  });
});

describe('Game.only', () => {
  const Unknown = Event.make('Unknown', {});
  const Elsewhere = Component.make('Elsewhere', Schema.Struct({ x: Schema.Finite }), {
    owner: 'simulation',
    network: 'server',
  });
  const Kept = Component.make('Kept', Schema.Struct({ x: Schema.Finite }), {
    owner: 'rules',
    network: 'server',
  });

  it('refuses a system reading, writing, emitting, or spawning what the game does not declare', () => {
    const reading = System.make({
      name: 'reading',
      reads: [Elsewhere],
      writes: [],
      emits: [],
      run: () => {},
    });
    const writing = System.make({
      name: 'writing',
      reads: [],
      writes: [Elsewhere],
      emits: [],
      run: () => {},
    });
    const emitting = System.make({
      name: 'emitting',
      reads: [],
      writes: [],
      emits: [Unknown],
      run: () => {},
    });
    const spawning = System.make({
      name: 'spawning',
      reads: [],
      writes: [],
      emits: [],
      spawns: [Elsewhere],
      run: () => {},
    });

    // @ts-expect-error `Elsewhere` is not part of the game.
    Game.only(fixture, { systems: [reading], rules: [] });
    // @ts-expect-error `Elsewhere` is not part of the game.
    Game.only(fixture, { systems: [writing], rules: [] });
    // @ts-expect-error `Unknown` is not part of the game.
    Game.only(fixture, { systems: [emitting], rules: [] });
    // @ts-expect-error `Elsewhere` is not part of the game.
    Game.only(fixture, { systems: [spawning], rules: [] });
  });

  it('refuses a rule handling, writing, emitting, or spawning what the game does not declare', () => {
    const handling = Rule.on(Unknown, { writes: [], emits: [], run: () => {} });
    const writing = Rule.on(Died, { writes: [Kept], emits: [], run: () => {} });
    const emitting = Rule.on(Died, { writes: [], emits: [Unknown], run: () => {} });
    const spawning = Rule.on(Died, { writes: [], emits: [], spawns: [Elsewhere], run: () => {} });

    // @ts-expect-error `Unknown` is not part of the game.
    Game.only(fixture, { systems: [], rules: [handling] });
    // @ts-expect-error `Kept` is not part of the game.
    Game.only(fixture, { systems: [], rules: [writing] });
    // @ts-expect-error `Unknown` is not part of the game.
    Game.only(fixture, { systems: [], rules: [emitting] });
    // @ts-expect-error `Elsewhere` is not part of the game.
    Game.only(fixture, { systems: [], rules: [spawning] });
  });

  it('lets a rule handle an action the game declares', () => {
    const restart = Rule.on(ChoseRestart, { writes: [], emits: [], run: () => {} });

    expect(Game.only(fixture, { systems: [], rules: [restart] }).rules).toEqual([restart]);
  });
});

describe('Game.schema', () => {
  const Json = Schema.fromJsonString(Game.schema(game));
  const [withRunner, runner] = spawnRunner(4, 60);
  const [withSplat, splat] = World.spawn(withRunner, [Splat.of({ size: 2 })]);
  const [whole, wall] = World.spawn(withSplat, [Wall.of({ x: 12 })]);
  const stepped = Game.step(game, whole).world;

  it('carries a whole world and back: its tick, randomness, next entity, and every component', () => {
    const text = Schema.encodeSync(Json)(stepped);
    const back = Schema.decodeSync(Json)(text);

    expect(back.tick).toBe(stepped.tick);
    expect(back.random).toBe(stepped.random);
    expect(back.nextEntity).toBe(stepped.nextEntity);
    expect(World.get(back, runner, Position)).toEqual(World.get(stepped, runner, Position));
    expect(World.get(back, runner, Health)).toEqual(Option.some({ current: 60 }));
    // A whole world holds what is local and what is private too; only a snapshot leaves them out.
    expect(World.get(back, splat, Splat)).toEqual(Option.some({ size: 2 }));
    expect(World.get(back, wall, Wall)).toEqual(Option.some({ x: 12 }));
    expect(Schema.encodeSync(Json)(back)).toBe(text);
  });

  it('steps a world it decoded as it steps the one it encoded', () => {
    const back = Schema.decodeSync(Json)(Schema.encodeSync(Json)(stepped));
    const encode = Schema.encodeSync(Json);

    expect(encode(Game.step(game, back).world)).toBe(encode(Game.step(game, stepped).world));
  });

  it('refuses a value its component cannot decode, or a component the game does not hold', () => {
    const text = Schema.encodeSync(Json)(stepped);
    const forged = text.replace('"current":60', '"current":"lots"');
    const foreign = text.replace('"Health"', '"Mana"');

    expect(Schema.decodeOption(Json)(forged)).toEqual(Option.none());
    expect(Schema.decodeOption(Json)(foreign)).toEqual(Option.none());
  });
});

describe('a component holding a state', () => {
  const Mood = Component.make(
    'Mood',
    Schema.Struct({
      state: Schema.Union([
        Schema.TaggedStruct('Calm', {}),
        Schema.TaggedStruct('Fleeing', { from: Schema.Finite }),
      ]),
      target: Schema.Option(Schema.Int),
    }),
    { owner: 'rules', network: 'server' },
  );
  const moody = Game.make({
    stepRate: 10,
    domains: [
      Domain.make({
        name: 'Test',
        requires: [],
        components: [Mood],
        actions: [],
        events: [],
        systems: [],
        rules: [],
      }),
    ],
  });
  const Json = Schema.fromJsonString(Game.schema(moody));
  const [calm, first] = World.spawn(World.empty({ seed: 1 }), [
    Mood.of({ state: { _tag: 'Calm' }, target: Option.none() }),
  ]);
  const [world, second] = World.spawn(calm, [
    Mood.of({ state: { _tag: 'Fleeing', from: 3 }, target: Option.some(7) }),
  ]);

  it('travels as a tagged union and an option, and arrives as one', () => {
    const back = Schema.decodeSync(Json)(Schema.encodeSync(Json)(world));

    expect(World.get(back, first, Mood)).toEqual(
      Option.some({ state: { _tag: 'Calm' }, target: Option.none() }),
    );
    expect(World.get(back, second, Mood)).toEqual(
      Option.some({ state: { _tag: 'Fleeing', from: 3 }, target: Option.some(7) }),
    );
  });

  it('travels in a snapshot too', () => {
    const back = Option.getOrThrow(
      Snapshot.apply(World.empty({ seed: 0 }), Snapshot.encode(world, moody), moody),
    ).world;

    expect(World.get(back, second, Mood)).toEqual(World.get(world, second, Mood));
  });
});

describe('commands', () => {
  const SavedHealth = Event.make('SavedHealth', { entity: Schema.Int });
  const FailedToSaveHealth = Event.make('FailedToSaveHealth', { entity: Schema.Int });
  const ran: Array<number> = [];
  const SaveHealth = Command.make('SaveHealth', {
    args: { entity: Schema.Int, current: Schema.Int },
    results: [SavedHealth, FailedToSaveHealth],
    execute: ({ entity }) =>
      Effect.sync(() => {
        ran.push(entity);
        return { _tag: 'SavedHealth', entity };
      }),
  });
  const Saved = Component.make('Saved', Schema.Struct({}), { owner: 'rules', network: 'server' });
  const save = Rule.on(Died, {
    writes: [],
    emits: [],
    commands: [SaveHealth],
    run: (context, died) => context.command(SaveHealth.of({ entity: died.entity, current: 0 })),
  });
  const mark = Rule.on(SavedHealth, {
    writes: [Saved],
    emits: [],
    run: (context, saved) => context.set(saved.entity, Saved, {}),
  });
  const Saver = Domain.make({
    name: 'Saver',
    requires: [Fixture],
    components: [Saved],
    actions: [],
    events: [SavedHealth, FailedToSaveHealth],
    commands: [SaveHealth],
    systems: [],
    rules: [save, mark],
  });
  const saving = Game.make({ stepRate: 10, domains: [Fixture, Saver] });

  it('are issued by the rules as values, and never run in a step', () => {
    ran.length = 0;
    Story.story(
      saving,
      Story.spawn('her', [Health.of({ current: 10 })]),
      Story.happen(Bitten, { entity: 0, damage: 30 }),
      Story.step(),
      Story.expectCommand(SaveHealth, (issued) =>
        expect(issued).toEqual([{ entity: 0, current: 0 }]),
      ),
    );

    expect(ran).toEqual([]);
  });

  it('come back as one of their results, which the rules handle at a later step', () => {
    Story.story(
      saving,
      Story.spawn('her', [Health.of({ current: 10 })]),
      Story.resolve(SaveHealth, SavedHealth, { entity: 0 }),
      Story.step(),
      Story.expectEqual('her', Saved, {}),
    );

    expect(() =>
      Story.story(
        saving,
        // @ts-expect-error Bitten is not what SaveHealth comes to.
        Story.resolve(SaveHealth, Bitten, { entity: 0, damage: 1 }),
      ),
    ).toThrow('Bitten is not what SaveHealth comes to');
  });

  it('are in the map of a game’s changes: which rules issue them, and what they come to', () => {
    expect(Game.changes(saving).commands.get('SaveHealth')).toEqual({
      issuedBy: [{ _tag: 'Rule', on: 'Died', name: Option.none(), domain: Option.some('Saver') }],
      results: ['SavedHealth', 'FailedToSaveHealth'],
    });
  });

  it('fail a story that expects one not issued', () => {
    expect(() => Story.story(saving, Story.step(), Story.expectCommand(SaveHealth))).toThrow(
      'no SaveHealth was issued',
    );
  });

  it('are issued only by rules, and only those a rule and its domain declare', () => {
    const Elsewhere = Command.make('Elsewhere', {
      args: {},
      results: [Bitten],
      execute: () =>
        Effect.succeed({ _tag: 'Bitten', entity: 0, damage: 0 } satisfies Event.ValueOf<
          typeof Bitten
        >),
    });
    const Foreign = Event.make('Foreign', {});
    const Unknown = Command.make('Unknown', {
      args: {},
      results: [Foreign],
      execute: () => Effect.succeed({ _tag: 'Foreign' } satisfies Event.ValueOf<typeof Foreign>),
    });

    Rule.on(Died, {
      writes: [],
      emits: [],
      commands: [SaveHealth],
      // @ts-expect-error Elsewhere is not among what this rule issues.
      run: (context) => context.command(Elsewhere.of({})),
    });
    System.make({
      name: 'issuing',
      reads: [],
      writes: [],
      emits: [],
      run: (context) => {
        // @ts-expect-error A system issues no commands.
        context.command(SaveHealth.of({ entity: 0, current: 0 }));
      },
    });
    Domain.make({
      name: 'Strange',
      requires: [Fixture],
      components: [],
      actions: [],
      events: [],
      // @ts-expect-error Foreign is not an event of the domain or of one it requires.
      commands: [Unknown],
      systems: [],
      rules: [],
    });
  });
});

describe('local systems', () => {
  /** A drop of blood on the floor: drawn by each client for itself, and never sent. */
  const Drop = Component.make('Drop', Schema.Struct({ x: Schema.Finite }), {
    owner: 'simulation',
    network: 'local',
  });
  /** Every entity with health bleeds a drop, somewhere near, every step a client sees. */
  const bleed = System.make({
    name: 'bleed',
    reads: [Health, Position],
    writes: [Drop],
    emits: [],
    spawns: [Drop],
    run: (context) => {
      for (const [, , position] of context.query(Health, Position)) {
        context.spawn([Drop.of({ x: position.x + context.random() })]);
      }
    },
  });
  const Blood = Domain.make({
    name: 'Blood',
    requires: [Fixture],
    components: [Drop],
    actions: [],
    events: [],
    systems: [],
    rules: [],
    localSystems: [bleed],
  });
  const bleeding = Game.make({ stepRate: 10, domains: [Fixture, Blood] });
  const [world] = spawnRunner(4, 60);
  const drops = (after: World.World) => World.query(after, Drop);

  it('run on a client, at a tick, and never on the server', () => {
    expect(drops(Game.step(bleeding, world).world)).toEqual([]);

    const local = Game.stepLocal(bleeding, world, { tick: 1 });
    expect(drops(local)).toHaveLength(1);
  });

  it('give what they spawn ids of their own, below the server’s, so the two never meet', () => {
    const once = Game.stepLocal(bleeding, world, { tick: 1 });
    const twice = Game.stepLocal(bleeding, once, { tick: 2 });

    expect(drops(twice).map(([entity]) => entity)).toEqual([-2, -1]);
    expect(twice.nextEntity).toBe(world.nextEntity);
  });

  it('draw the same numbers at the same tick on every client, leaving the world’s own untouched', () => {
    const at = (tick: number) => drops(Game.stepLocal(bleeding, world, { tick }));

    expect(at(5)).toEqual(at(5));
    expect(at(5)).not.toEqual(at(6));
    expect(Game.stepLocal(bleeding, world, { tick: 5 }).random).toBe(world.random);
  });

  it('are stepped in a story too, as by a client that sees every step', () => {
    Story.story(
      bleeding,
      Story.spawn('runner', runner(4, 60)),
      Story.steps(3),
      Story.world((after) => expect(drops(after)).toHaveLength(3)),
    );
  });

  it('are in the map of a game’s changes, as what changes what each client keeps', () => {
    expect(Game.changes(bleeding).components.get('Drop')).toEqual({
      readBy: [],
      writtenBy: [{ _tag: 'LocalSystem', name: 'bleed', domain: Option.some('Blood') }],
      spawnedBy: [{ _tag: 'LocalSystem', name: 'bleed', domain: Option.some('Blood') }],
    });
  });

  it('write and spawn only what is local and their domain’s, and emit nothing', () => {
    const writing = System.make({
      name: 'writing',
      reads: [],
      writes: [Position],
      emits: [],
      run: () => {},
    });
    const emitting = System.make({
      name: 'emitting',
      reads: [],
      writes: [],
      emits: [Bitten],
      run: () => {},
    });
    const settling = System.make({
      name: 'settling',
      reads: [],
      writes: [Drop],
      emits: [],
      run: () => {},
    });
    const parts = {
      requires: [Fixture],
      components: [Drop],
      actions: [],
      events: [],
      rules: [],
    } as const;

    // @ts-expect-error Position is the fixture's, and sent.
    Domain.make({ ...parts, name: 'Pushy', systems: [], localSystems: [writing] });
    // @ts-expect-error A local system emits nothing; events are for the server's rules.
    Domain.make({ ...parts, name: 'Noisy', systems: [], localSystems: [emitting] });
    // @ts-expect-error Drop is local: the server's systems never write it.
    Domain.make({ ...parts, name: 'Muddled', systems: [settling] });
  });
});

describe('a game declaring names twice', () => {
  it('refuses two components of one name, which would share one store and write over each other', () => {
    const Stride = Component.make('Stride', Schema.Struct({ walk: Schema.Finite }), {
      owner: 'simulation',
      network: 'local',
    });
    const OtherStride = Component.make('Stride', Schema.Struct({ cycles: Schema.Finite }), {
      owner: 'simulation',
      network: 'local',
    });
    const horde = Domain.make({
      name: 'Horde',
      requires: [],
      components: [Stride],
      actions: [],
      events: [],
      systems: [],
      rules: [],
    });
    const player = Domain.make({
      name: 'Player',
      requires: [],
      components: [OtherStride],
      actions: [],
      events: [],
      systems: [],
      rules: [],
    });

    expect(() => Game.make({ stepRate: 60, domains: [horde, player] })).toThrow(
      'two components named Stride',
    );
  });

  it('refuses two events of one tag, which the rules could not tell apart', () => {
    const Fell = Event.make('Fell', {});
    const OtherFell = Event.make('Fell', { far: Schema.Finite });
    const falling = System.make({
      name: 'falling',
      reads: [],
      writes: [],
      emits: [Fell],
      run: () => {},
    });
    const fallingFar = System.make({
      name: 'fallingFar',
      reads: [],
      writes: [],
      emits: [OtherFell],
      run: () => {},
    });
    const horde = Domain.make({
      name: 'Horde',
      requires: [],
      components: [],
      actions: [],
      events: [Fell],
      systems: [falling],
      rules: [],
    });
    const player = Domain.make({
      name: 'Player',
      requires: [],
      components: [],
      actions: [],
      events: [OtherFell],
      systems: [fallingFar],
      rules: [],
    });

    expect(() => Game.make({ stepRate: 60, domains: [horde, player] })).toThrow(
      'two actions or events tagged Fell',
    );
  });
});
