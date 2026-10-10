import { describe, expect, it } from '@effect/vitest';
import { Client, Component, Game, Host, System, Transport, World } from '@lightocean/core';
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
const components = [Position, Controls];

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
    game: Game.make({ stepRate: 60, systems: [steer], rules: [] }),
    world: World.empty({ seed: 1 }),
    components,
    join: (world) => World.spawn(world, [Position.of({ x: 0 }), Controls.of({ move: 0 })]),
    leave: World.despawn,
    mayHold: true,
    actions: [],
  });
  const [clientEnd, hostEnd] = yield* Transport.memoryPair;
  yield* host.connect(hostEnd);
  const client = yield* Client.connect(clientEnd, { components });
  const drawing = yield* Drawing.make(client, { keepSeconds: 2 });
  return { host, client, drawing };
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
});
