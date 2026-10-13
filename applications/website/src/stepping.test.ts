import { describe, expect, it } from '@effect/vitest';
import { Client, Host, State } from '@lightocean/core';
import { Debugger } from '@lightocean/devtools';
import { Transport } from '@lightocean/core/internal';
import { Effect } from 'effect';
import { TestClock } from 'effect/testing';
import * as Press from '#src/press.ts';
import * as Stepping from '#src/stepping.ts';

/** Lets `millis` of test time pass a little at a time, giving every fiber its turn. */
const pass = (millis: number) =>
  Effect.gen(function* () {
    for (let passed = 0; passed < millis; passed += 10) {
      yield* TestClock.adjust('10 millis');
      yield* Effect.yieldNow;
    }
  });

/** The press hosted with time suspended and the engine's debugger beside it, as its worker hosts it, and a page joined to it. */
const paged = Effect.gen(function* () {
  const host = yield* Host.make({ ...Press.setup, state: Press.state, maySuspend: true });
  yield* Debugger.serve(host, Press.setup);
  yield* Stepping.serve(host);
  const [clientEnd, hostEnd] = yield* Transport.memoryPair;
  yield* host.connect(hostEnd);
  const client = yield* Client.connect(clientEnd, { game: Press.game });
  return { host, client };
});

describe('a game stepped by hand', () => {
  it.effect('stands still however long time runs', () =>
    Effect.gen(function* () {
      const { host } = yield* paged;
      yield* pass(2000);

      expect((yield* host.state).tick).toBe(0);
    }),
  );

  it.effect(
    'shows a page the state it holds when the page asks, though no step has been taken',
    () =>
      Effect.gen(function* () {
        const { client } = yield* paged;
        yield* Stepping.show(client);
        yield* pass(100);

        expect(State.entitiesHolding(yield* client.state, [Press.Position])).toHaveLength(
          State.entitiesHolding(Press.state, [Press.Position]).length,
        );
      }),
  );

  it.effect('takes one step each time a page asks, and shows the page the state it took', () =>
    Effect.gen(function* () {
      const { host, client } = yield* paged;
      yield* Stepping.step(client);
      yield* Stepping.step(client);
      yield* pass(100);

      expect((yield* host.state).tick).toBe(2);
      expect((yield* client.state).tick).toBe(2);
    }),
  );

  it.effect(
    'goes back to an earlier state through the engine, and steps on from it to the very states it took before',
    () =>
      Effect.gen(function* () {
        const { host, client } = yield* paged;
        const warriorAt = (state: State.State) => [
          State.get(state, Press.warrior, Press.Position),
          State.get(state, Press.warrior, Press.Health),
        ];
        yield* Stepping.step(client);
        yield* Stepping.step(client);
        yield* Stepping.step(client);
        yield* pass(100);
        const before = yield* host.state;

        yield* Stepping.goBack(client, 1);
        yield* pass(100);
        const back = (yield* host.state).tick;
        yield* Stepping.step(client);
        yield* Stepping.step(client);
        yield* pass(100);
        const again = yield* host.state;

        expect(back).toBe(1);
        expect(again.tick).toBe(3);
        expect(again.random).toBe(before.random);
        expect(warriorAt(again)).toEqual(warriorAt(before));
        expect((yield* client.state).tick).toBe(3);
      }),
  );

  it.effect('stays suspended once it has gone back', () =>
    Effect.gen(function* () {
      const { host, client } = yield* paged;
      yield* Stepping.step(client);
      yield* Stepping.step(client);
      yield* pass(100);
      yield* Stepping.goBack(client, 1);
      yield* pass(2000);

      expect((yield* host.state).tick).toBe(1);
    }),
  );

  it.effect(
    'serves a page that suspends time itself, stepping when it asks, and running on once it resumes it',
    () =>
      Effect.gen(function* () {
        const host = yield* Host.make({ ...Press.setup, state: Press.state, maySuspend: true });
        yield* Stepping.carryOut(host);
        const [clientEnd, hostEnd] = yield* Transport.memoryPair;
        yield* host.connect(hostEnd);
        const client = yield* Client.connect(clientEnd, { game: Press.game });
        yield* client.suspend;
        yield* pass(100);
        const suspended = (yield* host.state).tick;
        yield* pass(2000);
        const stillSuspended = (yield* host.state).tick;
        yield* Stepping.step(client);
        yield* pass(100);
        const stepped = (yield* host.state).tick;
        yield* client.resume;
        yield* pass(2000);

        expect(stillSuspended).toBe(suspended);
        expect(stepped).toBe(suspended + 1);
        expect((yield* host.state).tick).toBeGreaterThan(stepped);
      }),
  );
});
