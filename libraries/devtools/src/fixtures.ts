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

/**
 * A small game the devtools' tests share, hosted and played for a while: a body that moves by its stick, and a player who asks to be healed.
 */

export const Position = Component.make('Position', Schema.Struct({ x: Schema.Finite }), {
  owner: 'simulation',
  network: 'server',
});

export const Health = Component.make('Health', Schema.Struct({ current: Schema.Int }), {
  owner: 'rules',
  network: 'server',
});

export const Stick = Component.make('Stick', Schema.Struct({ move: Schema.Finite }), {
  owner: 'input',
  network: 'predicted',
});

export const AskedToHeal = Action.make('AskedToHeal', { amount: Schema.Int });

/** The game, moving bodies by `move`, which is handed the step's context and each body's stick. */
const gameMoving = (move: (stick: { readonly move: number }) => number, stepRate = 30) =>
  Game.make({
    stepRate,
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
                context.set(entity, Position, { x: position.x + move(stick) });
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

/** The game as it should be: a body moves by what its stick holds. */
export const game = gameMoving((stick) => stick.move);

/** The game as a new build might make it: a body moves twice as far by the same stick. */
export const brisk = gameMoving((stick) => stick.move * 2);

/** The game stepped at another rate, which no host of the game can take up. */
export const slow = gameMoving((stick) => stick.move, 10);

/** The game as it should not be: a body moves by how many bodies it has moved before in this process, which nothing in the world holds, so no replay of it comes out the same. */
export const drifting = () => {
  const moved = { count: 0 };
  return gameMoving((stick) => {
    moved.count += 1;
    return stick.move + moved.count;
  });
};

/** The game, or one that does not replay, built the same way. */
type Played = typeof game;

/** Joining spawns a body, standing still, at the start, hurt; leaving takes it away. */
export const join = (world: World.World) =>
  World.spawn(world, [Position.of({ x: 0 }), Health.of({ current: 1 }), Stick.of({ move: 0 })]);

export const setup = (played: Played = game) => ({ game: played, join, leave: World.despawn });

/** Hosts `played`, until the scope closes; a host that lets clients hold time if `mayHold`, as a local server for one player does. */
export const host = (played: Played = game, mayHold = false) =>
  Host.make({ ...setup(played), world: World.empty({ seed: 7 }), mayHold });

/** Lets `millis` of test time pass a little at a time, giving every fiber its turn. */
export const advance = (millis: number) =>
  Effect.gen(function* () {
    for (let passed = 0; passed < millis; passed += 10) {
      yield* TestClock.adjust(`${Math.min(10, millis - passed)} millis`);
      yield* Effect.yieldNow;
    }
  });

/** A player who joins `hosted`, walks, asks to be healed, and leaves, as `played` is hosted. */
export const visit = (hosted: Host.Host, played: Played = game) =>
  Effect.gen(function* () {
    const [clientEnd, hostEnd] = yield* Transport.memoryPair;
    const scope = yield* Scope.make();
    const entity = yield* hosted.connect(hostEnd).pipe(Scope.provide(scope));
    const client = yield* Client.connect(clientEnd, { game: played }).pipe(Scope.provide(scope));
    yield* client.send([Stick.of({ move: 1 })]);
    yield* client.act(AskedToHeal, { amount: 50 });
    yield* advance(100);
    yield* Scope.close(scope, Exit.void);
    yield* Effect.yieldNow;
    return entity;
  });

/** `played` hosted a while, then recorded while a player visits. */
export const recorded = (played: Played = game) =>
  Effect.gen(function* () {
    const hosted = yield* host(played);
    yield* advance(100);
    const recorder = yield* Recording.record(hosted, played);
    const entity = yield* visit(hosted, played);
    return { hosted, entity, recording: yield* recorder.recording };
  });
