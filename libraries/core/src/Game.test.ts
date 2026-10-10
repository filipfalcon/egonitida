import { describe, expect, it } from '@effect/vitest';
import { Option, Schema } from 'effect';
import * as Component from '#src/Component.ts';
import * as Event from '#src/Event.ts';
import {
  Bitten,
  Controls,
  Died,
  declared,
  Health,
  Position,
  Restart,
  Velocity,
} from '#src/fixtures.ts';
import * as Game from '#src/Game.ts';
import * as Input from '#src/Input.ts';
import * as Rule from '#src/Rule.ts';
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

const game = Game.make({ stepRate: 10, ...declared, systems: [move, bite], rules: [takeBite] });

const spawnRunner = (x: number, health: number) =>
  World.spawn(World.empty({ seed: 7 }), [
    Position.of({ x }),
    Velocity.of({ x: 10 }),
    Health.of({ current: health }),
  ]);

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
    const [world, runner] = spawnRunner(9, 100);
    const after = Game.step(game, world).world;

    expect(World.get(after, runner, Health)).toEqual(Option.some({ current: 70 }));
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
    const twice = Game.make({
      stepRate: 10,
      ...declared,
      systems: [doubleBite],
      rules: [takeBite],
    });
    const [world, runner] = spawnRunner(0, 50);

    const { world: after, events } = Game.step(twice, world);

    // The second bite sees the health the first one left, so the runner dies exactly once.
    expect(World.get(after, runner, Health)).toEqual(Option.some({ current: -10 }));
    expect(events.filter((event) => event._tag === 'Died')).toEqual([
      { _tag: 'Died', entity: runner },
    ]);
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
const contents = (world: World.World) =>
  Snapshot.encode(world, [Position, Velocity, Health, Controls]);

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
  const noisy = Game.make({ stepRate: 10, ...declared, systems: [scatter], rules: [] });
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
  const steered = Game.make({ stepRate: 10, ...declared, systems: [steer], rules: [] });
  const [start, player] = World.spawn(World.empty({ seed: 1 }), [
    Position.of({ x: 0 }),
    Controls.of({ move: 0, fire: false }),
  ]);
  const push = (move: number) => [Input.of(player, Controls, { move, fire: false })];

  it('reaches the systems in the step it is given to', () => {
    const after = Game.step(steered, start, push(1)).world;

    expect(World.get(after, player, Position)).toEqual(Option.some({ x: 1 }));
  });

  it('stays as it was in a step given no new input, the way a held stick does', () => {
    const once = Game.step(steered, start, push(1)).world;
    const twice = Game.step(steered, once).world;

    expect(World.get(twice, player, Position)).toEqual(Option.some({ x: 2 }));
  });

  it('only reaches an entity spawned to accept it', () => {
    const [world, bystander] = World.spawn(start, [Position.of({ x: 5 })]);
    const after = Game.step(steered, world, [
      Input.of(bystander, Controls, { move: 1, fire: false }),
    ]).world;

    expect(World.get(after, bystander, Controls)).toEqual(Option.none());
    expect(World.get(after, bystander, Position)).toEqual(Option.some({ x: 5 }));
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
    expect(World.get(play(), player, Position)).toEqual(Option.some({ x: 2.25 }));
  });
});

describe('actions', () => {
  // The rules put a restarting player's health back, and a system that runs after sees it this very step.
  const restart = Rule.on(Restart, {
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
  const restarting = Game.make({ stepRate: 10, ...declared, systems: [look], rules: [restart] });
  const [world, player] = spawnRunner(0, 10);
  /** An action as the host hands it on: sent by a client, then accepted as from its player. */
  const restarted = (x: number) => Option.getOrThrow(Restart.accept(Restart.encode({ x }), player));

  it('is handled by the rules within the step it arrives, before the systems run', () => {
    seen.length = 0;
    const { world: after } = Game.step(restarting, world, [], [restarted(0)]);

    expect(World.get(after, player, Health)).toEqual(Option.some({ current: 100 }));
    expect(seen).toEqual([100]);
  });

  it('is reported first among the step’s events, in the order the actions came', () => {
    const { events } = Game.step(restarting, world, [], [restarted(1), restarted(2)]);

    expect(events).toEqual([
      { _tag: 'Restart', x: 1, player },
      { _tag: 'Restart', x: 2, player },
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
    const lifecycle = Game.make({ stepRate: 10, ...declared, systems: [raise, move], rules: [] });
    const after = Game.step(lifecycle, world).world;
    const runner = keeper + 1;

    // `move`, running after `raise`, already moved it by a step.
    expect(World.get(after, runner, Position)).toEqual(Option.some({ x: 1 }));
    expect(after.nextEntity).toBe(runner + 1);
  });

  it('takes a despawned entity out of every store at once, so later systems no longer see it', () => {
    const lifecycle = Game.make({
      stepRate: 10,
      ...declared,
      systems: [raise, move, move, remove, move],
      rules: [],
    });
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
    const replacing = Game.make({
      stepRate: 10,
      ...declared,
      systems: [bite],
      rules: [takeBite, replace],
    });
    const [start, runner] = spawnRunner(10, 30);
    const after = Game.step(replacing, start).world;

    expect(World.get(after, runner, Health)).toEqual(Option.none());
    expect(World.get(after, runner + 1, Health)).toEqual(Option.some({ current: 100 }));
  });

  it('leaves the world it was given untouched', () => {
    const lifecycle = Game.make({
      stepRate: 10,
      ...declared,
      systems: [raise, move, move, remove],
      rules: [],
    });
    Game.step(lifecycle, world);

    expect(world.nextEntity).toBe(keeper + 1);
    expect(World.query(world, Position)).toEqual([]);
  });

  it('replays to the same world, ids and all', () => {
    const lifecycle = Game.make({
      stepRate: 10,
      ...declared,
      systems: [raise, move, remove],
      rules: [],
    });
    const play = () =>
      Array.from({ length: 12 }).reduce<World.World>(
        (current) => Game.step(lifecycle, current).world,
        world,
      );

    expect(contents(play())).toEqual(contents(play()));
    expect(play().nextEntity).toBe(play().nextEntity);
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

describe('Game.make', () => {
  const Unknown = Event.make('Unknown', {});
  const Elsewhere = Component.make('Elsewhere', Schema.Struct({ x: Schema.Finite }), {
    owner: 'simulation',
    network: 'server',
  });
  const Kept = Component.make('Kept', Schema.Struct({ x: Schema.Finite }), {
    owner: 'rules',
    network: 'server',
  });

  it('keeps what the game is made of', () => {
    expect(game.components.map(({ name }) => name)).toEqual([
      'Position',
      'Velocity',
      'Health',
      'Controls',
      'Splat',
      'Wall',
    ]);
    expect(game.actions.map(({ tag }) => tag)).toEqual(['Restart']);
    expect(game.events.map(({ tag }) => tag)).toEqual(['Bitten', 'Died']);
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
    Game.make({ stepRate: 10, ...declared, systems: [reading], rules: [] });
    // @ts-expect-error `Elsewhere` is not part of the game.
    Game.make({ stepRate: 10, ...declared, systems: [writing], rules: [] });
    // @ts-expect-error `Unknown` is not part of the game.
    Game.make({ stepRate: 10, ...declared, systems: [emitting], rules: [] });
    // @ts-expect-error `Elsewhere` is not part of the game.
    Game.make({ stepRate: 10, ...declared, systems: [spawning], rules: [] });
  });

  it('refuses a rule handling, writing, emitting, or spawning what the game does not declare', () => {
    const handling = Rule.on(Unknown, { writes: [], emits: [], run: () => {} });
    const writing = Rule.on(Died, { writes: [Kept], emits: [], run: () => {} });
    const emitting = Rule.on(Died, { writes: [], emits: [Unknown], run: () => {} });
    const spawning = Rule.on(Died, { writes: [], emits: [], spawns: [Elsewhere], run: () => {} });

    // @ts-expect-error `Unknown` is not part of the game.
    Game.make({ stepRate: 10, ...declared, systems: [], rules: [handling] });
    // @ts-expect-error `Kept` is not part of the game.
    Game.make({ stepRate: 10, ...declared, systems: [], rules: [writing] });
    // @ts-expect-error `Unknown` is not part of the game.
    Game.make({ stepRate: 10, ...declared, systems: [], rules: [emitting] });
    // @ts-expect-error `Elsewhere` is not part of the game.
    Game.make({ stepRate: 10, ...declared, systems: [], rules: [spawning] });
  });

  it('lets a rule handle an action the game declares', () => {
    const restart = Rule.on(Restart, { writes: [], emits: [], run: () => {} });

    expect(Game.make({ stepRate: 10, ...declared, systems: [], rules: [restart] }).rules).toEqual([
      restart,
    ]);
  });
});
