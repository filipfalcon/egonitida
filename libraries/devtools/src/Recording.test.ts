import { describe, expect, it } from '@effect/vitest';
import {
  Action,
  Client,
  Component,
  Domain,
  Game,
  Host,
  Rule,
  System,
  World,
} from '@lightocean/core';
import { Transport } from '@lightocean/core/internal';
import { Effect, Exit, Schema, Scope } from 'effect';
import { TestClock } from 'effect/testing';
import * as Recording from '#src/Recording.ts';

const Position = Component.make('Position', Schema.Struct({ x: Schema.Finite }), {
  owner: 'simulation',
  network: 'server',
});
const Health = Component.make('Health', Schema.Struct({ current: Schema.Int }), {
  owner: 'rules',
  network: 'server',
});
const Stick = Component.make('Stick', Schema.Struct({ move: Schema.Finite }), {
  owner: 'input',
  network: 'predicted',
});
const AskedToHeal = Action.make('AskedToHeal', { amount: Schema.Int });

/** A body moves by its stick, and a player who asks to be healed is. */
const game = Game.make({
  stepRate: 30,
  domains: [
    Domain.make({
      name: 'Test',
      requires: [],
      components: [Position, Health, Stick],
      actions: [AskedToHeal],
      events: [],
      systems: [
        System.make({
          name: 'steer',
          reads: [Stick],
          writes: [Position],
          emits: [],
          run: (context) => {
            for (const [entity, position, stick] of context.query(Position, Stick)) {
              context.set(entity, Position, { x: position.x + stick.move });
            }
          },
        }),
      ],
      rules: [
        Rule.on(AskedToHeal, {
          writes: [Health],
          emits: [],
          run: (context, asked) => {
            context.set(asked.player, Health, { current: asked.amount });
          },
        }),
      ],
    }),
  ],
});

const startHost = Host.make({
  game,
  world: World.empty({ seed: 7 }),
  join: (world) =>
    World.spawn(world, [Position.of({ x: 0 }), Health.of({ current: 1 }), Stick.of({ move: 0 })]),
  leave: World.despawn,
  mayHold: false,
});

/** Lets `millis` of test time pass a little at a time, giving every fiber its turn. */
const advance = (millis: number) =>
  Effect.gen(function* () {
    for (let passed = 0; passed < millis; passed += 10) {
      yield* TestClock.adjust(`${Math.min(10, millis - passed)} millis`);
      yield* Effect.yieldNow;
    }
  });

/** A host recorded while a player joins, walks, asks to be healed, and leaves. */
const played = Effect.gen(function* () {
  const host = yield* startHost;
  yield* advance(100);
  const recorder = yield* Recording.record(host, game);
  const [clientEnd, hostEnd] = yield* Transport.memoryPair;
  const scope = yield* Scope.make();
  const entity = yield* host.connect(hostEnd).pipe(Scope.provide(scope));
  const client = yield* Client.connect(clientEnd, { game }).pipe(Scope.provide(scope));
  yield* client.send([Stick.of({ move: 1 })]);
  yield* client.act(AskedToHeal, { amount: 50 });
  yield* advance(100);
  yield* Scope.close(scope, Exit.void);
  yield* Effect.yieldNow;
  return { entity, recording: yield* recorder.recording };
});

describe('a recording', () => {
  it.effect('starts from the world as it was when recording began, as its game encodes it', () =>
    Effect.gen(function* () {
      const { recording } = yield* played;

      expect(recording.stepRate).toBe(30);
      expect(recording.first).toEqual({
        tick: 3,
        nextEntity: 0,
        nextLocal: -1,
        random: expect.any(Number),
        stores: {},
      });
    }),
  );

  it.effect(
    'keeps every join, leave, and step after it, with the input and actions that went in',
    () =>
      Effect.gen(function* () {
        const { entity, recording } = yield* played;

        expect(recording.entries).toEqual([
          { _tag: 'Joined', entity },
          {
            _tag: 'Stepped',
            tick: 4,
            inputs: [{ entity, component: 'Stick', value: { move: 1 } }],
            actions: [{ _tag: 'AskedToHeal', amount: 50, player: entity }],
          },
          { _tag: 'Stepped', tick: 5, inputs: [], actions: [] },
          { _tag: 'Stepped', tick: 6, inputs: [], actions: [] },
          { _tag: 'Left', entity },
        ]);
      }),
  );

  it.effect('is data: it is the same after travelling as JSON', () =>
    Effect.gen(function* () {
      const { recording } = yield* played;
      const json = Schema.fromJsonString(Recording.Recording);

      const travelled = yield* Schema.decodeEffect(json)(
        yield* Schema.encodeEffect(json)(recording),
      );

      expect(travelled).toEqual(recording);
    }),
  );
});
