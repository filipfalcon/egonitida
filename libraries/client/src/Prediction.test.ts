import { describe, expect, it } from '@effect/vitest';
import { Client, Component, Domain, Game, Host, System, State } from '@lightocean/core';
import { Transport } from '@lightocean/core/internal';
import { Effect, Option, Schema } from 'effect';
import * as Drawing from '#src/Drawing.ts';
import * as Prediction from '#src/Prediction.ts';

/** Which way the player steers, and where they stand, which their own client predicts. */
const Steering = Component.make('Steering', Schema.Struct({ x: Schema.Finite }), {
  owner: 'input',
  network: 'predicted',
});
const Position = Component.make('Position', Schema.Struct({ x: Schema.Finite }), {
  owner: 'simulation',
  network: 'predicted',
});
/** Walks every player the way they steer, at 3 metres a second. */
const walk = System.make({
  name: 'walk',
  reads: [Steering],
  writes: [Position],
  emits: [],
  run: (context) => {
    for (const [player, steering, position] of context.query(Steering, Position)) {
      context.set(player, Position, {
        x: position.x + steering.x * 3 * context.time.secondsPerStep,
      });
    }
  },
});
const game = Game.make({
  stepRate: 30,
  domains: [
    Domain.make({
      name: 'Walking',
      requires: [],
      components: [Steering, Position],
      actions: [],
      events: [],
      systems: [walk],
      rules: [],
    }),
  ],
});

/** A host and one client joined to it across a network 100 milliseconds away each way. */
const faraway = Effect.gen(function* () {
  const host = yield* Host.make({
    game,
    state: State.empty({ seed: 1 }),
    join: (state) => State.spawn(state, [Steering.of({ x: 0 }), Position.of({ x: 0 })]),
    leave: State.despawn,
    mayHold: false,
  });
  const [clientEnd, hostEnd] = yield* Transport.memoryPair;
  const conditions = { latencyMillis: 100, loss: 0, random: () => 1 };
  yield* host.connect(yield* Transport.withConditions(hostEnd, conditions));
  const client = yield* Client.connect(yield* Transport.withConditions(clientEnd, conditions), {
    game,
  });
  const drawing = yield* Drawing.make(client, { keepSeconds: 1 });
  const prediction = yield* Prediction.make(client, game);
  /** Where the player stands as the next frame, `seconds` on, draws them. */
  const drawn = (seconds: number) =>
    Option.flatMap(drawing.frame(seconds), (frame) =>
      Option.map(prediction.frame(frame, seconds).get(client.entity, Position), ({ x }) => x),
    );
  /** Where the player stands in the newest state the host sent. */
  const confirmed = Effect.map(client.state, (state) =>
    Option.map(State.get(state, client.entity, Position), ({ x }) => x),
  );
  return { client, prediction, drawn, confirmed };
});

describe('a player predicted by their own client', () => {
  // Real time: the network's delay is real, as is the client's own step.
  it.live('moves the moment they steer, before the host has heard of it', () =>
    Effect.gen(function* () {
      const { prediction, drawn, confirmed } = yield* faraway;
      yield* Effect.sleep('300 millis');

      prediction.hold([Steering.of({ x: 1 })]);
      yield* Effect.sleep('120 millis');

      expect(yield* confirmed).toEqual(Option.some(0));
      expect(Option.map(drawn(0.12), (x) => x > 0)).toEqual(Option.some(true));
    }).pipe(Effect.scoped),
  );

  it.live('stands where the host says once it stops and the host has caught up', () =>
    Effect.gen(function* () {
      const { prediction, drawn, confirmed } = yield* faraway;
      yield* Effect.sleep('300 millis');

      prediction.hold([Steering.of({ x: 1 })]);
      yield* Effect.sleep('300 millis');
      prediction.hold([Steering.of({ x: 0 })]);
      yield* Effect.sleep('600 millis');
      for (let frame = 0; frame < 30; frame += 1) {
        drawn(1 / 60);
      }

      const there = Option.getOrElse(yield* confirmed, () => Number.NaN);
      expect(there).toBeGreaterThan(0);
      expect(Option.map(drawn(1 / 60), (x) => Math.abs(x - there) < 0.01)).toEqual(
        Option.some(true),
      );
    }).pipe(Effect.scoped),
  );
});
