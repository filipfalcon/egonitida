import { describe, expect, it } from '@effect/vitest';
import { Client, Component, Game, Host, Plugin, System, Transport, World } from '@lightocean/core';
import { Effect, Option, Schema } from 'effect';
import { TestClock } from 'effect/testing';
import * as Drawing from '#src/Drawing.ts';

const Position = Component.make('Position', Schema.Struct({ x: Schema.Finite }), {
  owner: 'simulation',
  network: 'predicted',
});
const Controls = Component.make('Controls', Schema.Struct({ move: Schema.Finite }), {
  owner: 'input',
  network: 'predicted',
});

/** Moves every controlled entity by one per step, so a drawn position reads as a tick. */
const steer = System.make({
  name: 'steer',
  reads: [Controls],
  writes: [Position],
  emits: [],
  run: (context) => {
    for (const [entity, position, controls] of context.query(Position, Controls)) {
      context.set(entity, Position, { x: position.x + controls.move });
    }
  },
});

const steered = Game.make({
  stepRate: 60,
  plugins: [
    Plugin.make({
      name: 'Test',
      requires: [],
      components: [Position, Controls],
      actions: [],
      events: [],
      systems: [steer],
      rules: [],
    }),
  ],
});

const STEP_MILLIS = 1000 / 60;

/** One frame of a display at 60 Hz: test time passes, every fiber has its turn, and the drawing moves on. */
const frame = (drawing: Drawing.Drawing) =>
  Effect.gen(function* () {
    yield* TestClock.adjust(`${STEP_MILLIS} millis`);
    yield* Effect.yieldNow;
    return drawing.frame(STEP_MILLIS / 1000);
  });

const session = Effect.gen(function* () {
  const host = yield* Host.make({
    game: steered,
    world: World.empty({ seed: 1 }),
    join: (world) => World.spawn(world, [Position.of({ x: 0 }), Controls.of({ move: 0 })]),
    leave: World.despawn,
    mayHold: true,
  });
  const [clientEnd, hostEnd] = yield* Transport.memoryPair;
  yield* host.connect(hostEnd);
  const client = yield* Client.connect(clientEnd, { game: steered });
  const drawing = yield* Drawing.make(client, { keepSeconds: 2 });
  return { host, client, drawing };
});

/** A session whose host raises a marker at tick 5 and removes it at tick 10. */
const marked = Effect.gen(function* () {
  const host = yield* Host.make({
    game: marking,
    world: World.empty({ seed: 1 }),
    join: (world) => World.spawn(world, []),
    leave: World.despawn,
    mayHold: true,
  });
  const [clientEnd, hostEnd] = yield* Transport.memoryPair;
  yield* host.connect(hostEnd);
  const client = yield* Client.connect(clientEnd, { game: marking });
  return yield* Drawing.make(client, { keepSeconds: 2 });
});

/** A marker that lives from tick 5 to tick 10 of the host's world, flagged from tick 8. */
const Marker = Component.make('Marker', Schema.Struct({}), {
  owner: 'simulation',
  network: 'server',
});
/** A flag the marker is given at tick 8, as a moment such as a hit is given to what it hits. */
const Flag = Component.make('Flag', Schema.Struct({}), {
  owner: 'simulation',
  network: 'server',
});
const mark = System.make({
  name: 'mark',
  reads: [Marker],
  writes: [Flag],
  emits: [],
  spawns: [Marker],
  despawns: true,
  run: (context) => {
    if (context.time.tick === 5) {
      context.spawn([Marker.of({})]);
    }
    if (context.time.tick === 8) {
      for (const [marker] of context.query(Marker)) {
        context.set(marker, Flag, {});
      }
    }
    if (context.time.tick === 10) {
      for (const [marker] of context.query(Marker)) {
        context.despawn(marker);
      }
    }
  },
});
const marking = Game.make({
  stepRate: 60,
  plugins: [
    Plugin.make({
      name: 'Test',
      requires: [],
      components: [Marker, Flag],
      actions: [],
      events: [],
      systems: [mark],
      rules: [],
    }),
  ],
});

const xOf = (view: Option.Option<Drawing.View>, entity: World.Entity) =>
  Option.getOrElse(
    Option.flatMap(view, (drawn) =>
      Option.map(drawn.get(entity, Position), (position) => position.x),
    ),
    () => Number.NaN,
  );

describe('Drawing', () => {
  it.effect('draws nothing before the host sends a world', () =>
    Effect.gen(function* () {
      const { drawing } = yield* session;

      expect(drawing.frame(0)).toEqual(Option.none());
    }),
  );

  it.effect('draws the session a step behind its host, moving every frame', () =>
    Effect.gen(function* () {
      const { host, client, drawing } = yield* session;
      yield* client.send([Controls.of({ move: 1 })]);

      const drawn: Array<number> = [];
      for (let index = 0; index < 30; index += 1) {
        drawn.push(xOf(yield* frame(drawing), client.entity));
      }

      const stepped = yield* host.world;
      const last = drawn.at(-1) ?? Number.NaN;
      // Drawing follows the host a step or so behind, never ahead of it.
      expect(last).toBeLessThanOrEqual(stepped.tick);
      expect(last).toBeGreaterThanOrEqual(stepped.tick - 2);
      // And it only ever moves forward.
      const settled = drawn.filter((x) => !Number.isNaN(x));
      expect(settled.every((x, index) => index === 0 || x >= (settled[index - 1] ?? x))).toBe(true);
    }),
  );

  it.effect('tells, frame by frame, which entities came into the drawing and which left it', () =>
    Effect.gen(function* () {
      const drawing = yield* marked;

      const changes: Array<string> = [];
      for (let index = 0; index < 30; index += 1) {
        const view = yield* frame(drawing);
        Option.map(view, ({ entered, left }) => {
          changes.push(
            ...entered.map((entity) => `+${entity}`),
            ...left.map((entity) => `-${entity}`),
          );
        });
      }

      // The player joined as entity 0 and holds nothing, so only the marker, entity 1, is drawn: it comes once and goes once.
      expect(changes).toEqual(['+1', '-1']);
    }),
  );

  it.effect('tells, frame by frame, which entities gained a component and which lost it', () =>
    Effect.gen(function* () {
      const drawing = yield* marked;

      const changes: Array<string> = [];
      for (let index = 0; index < 30; index += 1) {
        const view = yield* frame(drawing);
        Option.map(view, ({ entered, gained, lost, left }) => {
          changes.push(
            ...entered.map((entity) => `+${entity}`),
            ...gained(Flag).map((entity) => `flag +${entity}`),
            ...lost(Flag).map((entity) => `flag -${entity}`),
            ...left.map((entity) => `-${entity}`),
          );
        });
      }

      // Flagged after it came, the marker loses its flag as it leaves.
      expect(changes).toEqual(['+1', 'flag +1', 'flag -1', '-1']);
    }),
  );
});
