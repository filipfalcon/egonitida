import { describe, expect, it } from '@effect/vitest';
import { Client, Component, Game, Host, Domain, System, State } from '@nitida/core';
import { Transport } from '@nitida/core/internal';
import { Effect, Option, Schema } from 'effect';
import { TestClock } from 'effect/testing';
import * as Drawing from '#src/Drawing.ts';
import * as Timeline from '#src/Timeline.ts';

const Position = Component.make('Position', Schema.Struct({ x: Schema.Finite }), {
  owner: 'simulation',
  network: 'predicted',
});
const Controls = Component.make('Controls', Schema.Struct({ move: Schema.Finite }), {
  owner: 'demand',
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
  domains: [
    Domain.make({
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
    state: State.empty({ seed: 1 }),
    join: (state) => State.spawn(state, [Position.of({ x: 0 }), Controls.of({ move: 0 })]),
    leave: State.despawn,
    maySuspend: true,
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
    state: State.empty({ seed: 1 }),
    join: (state) => State.spawn(state, []),
    leave: State.despawn,
    maySuspend: true,
  });
  const [clientEnd, hostEnd] = yield* Transport.memoryPair;
  yield* host.connect(hostEnd);
  const client = yield* Client.connect(clientEnd, { game: marking });
  return yield* Drawing.make(client, { keepSeconds: 2 });
});

/** A marker that lives from tick 5 to tick 10 of the host's state, flagged at tick 8 and flagged anew at tick 9. */
const Marker = Component.make('Marker', Schema.Struct({}), {
  owner: 'simulation',
  network: 'server',
});
/** A flag the marker is given at tick 8, as a moment such as a hit is given to what it hits. */
const Flag = Component.make('Flag', Schema.Struct({ at: Schema.Int }), {
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
    if (context.time.tick === 8 || context.time.tick === 9) {
      for (const [marker] of context.query(Marker)) {
        context.set(marker, Flag, { at: context.time.tick });
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
  domains: [
    Domain.make({
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

const xOf = (view: Option.Option<Drawing.Frame>, entity: State.Entity) =>
  Option.getOrElse(
    Option.flatMap(view, (drawn) =>
      Option.map(drawn.get(entity, Position), (position) => position.x),
    ),
    () => Number.NaN,
  );

describe('Drawing', () => {
  it.effect('draws nothing before the host sends a state', () =>
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

      const stepped = yield* host.state;
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

  it.effect(
    'tells, frame by frame, which entities gained a component, held it anew, or lost it',
    () =>
      Effect.gen(function* () {
        const drawing = yield* marked;

        const changes: Array<string> = [];
        for (let index = 0; index < 30; index += 1) {
          const view = yield* frame(drawing);
          Option.map(view, ({ entered, gained, changed, lost, left }) => {
            changes.push(
              ...entered.map((entity) => `+${entity}`),
              ...gained(Flag).map((entity) => `flag +${entity}`),
              ...changed(Flag).map((entity) => `flag ~${entity}`),
              ...lost(Flag).map((entity) => `flag -${entity}`),
              ...left.map((entity) => `-${entity}`),
            );
          });
        }

        // Flagged after it came and flagged anew a step later, the marker loses its flag as it leaves.
        expect(changes).toEqual(['+1', 'flag +1', 'flag ~1', 'flag -1', '-1']);
      }),
  );
});

describe('a frame’s randomness', () => {
  const [state, crate] = State.spawn(State.empty({ seed: 7 }), []);
  const [withTwo, barrel] = State.spawn(state, []);
  const drawn = (at: State.State) => Drawing.frameOf(Timeline.still(at), Option.none());
  const draws = (random: () => number) => [random(), random(), random()];

  it('is the same for the same state, entity, and part, wherever it is drawn', () => {
    expect(draws(drawn(withTwo).random(crate, 'tilt'))).toEqual(
      draws(drawn(withTwo).random(crate, 'tilt')),
    );
  });

  it('is another for another entity, part, tick, or seed', () => {
    const first = draws(drawn(withTwo).random(crate, 'tilt'));
    expect(draws(drawn(withTwo).random(barrel, 'tilt'))).not.toEqual(first);
    expect(draws(drawn(withTwo).random(crate, 'flicker'))).not.toEqual(first);
    expect(draws(drawn({ ...withTwo, tick: 1 }).random(crate, 'tilt'))).not.toEqual(first);
    expect(draws(drawn({ ...withTwo, random: 8 }).random(crate, 'tilt'))).not.toEqual(first);
  });

  it('draws numbers from 0 up to 1, each another', () => {
    const numbers = draws(drawn(withTwo).random(crate, 'tilt'));
    expect(new Set(numbers).size).toBe(3);
    for (const number of numbers) {
      expect(number).toBeGreaterThanOrEqual(0);
      expect(number).toBeLessThan(1);
    }
  });
});

describe('how far a frame’s drawing advanced', () => {
  const at = (tick: number) => Timeline.still({ ...State.empty({ seed: 1 }), tick });

  it('is nothing at the first frame', () => {
    expect(Drawing.frameOf(at(5), Option.none()).advanced).toBe(0);
  });

  it('is the ticks drawn since the frame before, back as well as on', () => {
    expect(Drawing.frameOf(at(5), Option.some(at(3))).advanced).toBe(2);
    expect(Drawing.frameOf(at(3), Option.some(at(5))).advanced).toBe(-2);
  });
});
