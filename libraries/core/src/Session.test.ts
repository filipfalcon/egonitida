import { describe, expect, it } from '@effect/vitest';
import { Context, Effect, Exit, Fiber, Option, Schema, Scope, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import * as Action from '#src/Action.ts';
import * as Client from '#src/Client.ts';
import * as Command from '#src/Command.ts';
import * as Component from '#src/Component.ts';
import { Controls, Health, Position } from '#src/fixtures.ts';
import * as Game from '#src/Game.ts';
import * as Domain from '#src/Domain.ts';
import * as Host from '#src/Host.ts';
import * as Protocol from '#src/Protocol.ts';
import * as Rule from '#src/Rule.ts';
import * as System from '#src/System.ts';
import * as Transport from '#src/Transport.ts';
import * as State from '#src/State.ts';

/** Moves every controlled entity by its stick, at 30 a second. */
const steer = System.make({
  name: 'steer',
  reads: [Controls],
  writes: [Position],
  emits: [],
  run: (context) => {
    for (const [entity, position, controls] of context.query(Position, Controls)) {
      context.set(entity, Position, {
        x: position.x + controls.move * 30 * context.time.secondsPerStep,
      });
    }
  },
});

/** A player asked to be healed to an amount; the rules grant it to whoever asked. */
const AskedToHeal = Action.make('AskedToHeal', { amount: Schema.Int });
const heal = Rule.on(AskedToHeal, {
  reads: [],
  writes: [Health],
  emits: [],
  run: (context, healed) => {
    context.set(healed.player, Health, { current: healed.amount });
  },
});

const game = Game.make({
  stepRate: 30,
  domains: [
    Domain.make({
      name: 'Test',
      requires: [],
      components: [Position, Controls, Health],
      actions: [AskedToHeal],
      events: [],
      systems: [steer],
      rules: [heal],
    }),
  ],
});

const hostOptions = (maySuspend: boolean): Host.Options => ({
  game,
  state: State.empty({ seed: 1 }),
  join: (state) =>
    State.spawn(state, [
      Position.of({ x: 0 }),
      Controls.of({ move: 0, fire: false }),
      Health.of({ current: 0 }),
    ]),
  leave: State.despawn,
  maySuspend,
});

const startHost = Host.make(hostOptions(true));

/** A host and one client joined to it, over a connection in memory. */
const session = Effect.gen(function* () {
  const host = yield* startHost;
  const [clientEnd, hostEnd] = yield* Transport.memoryPair;
  yield* host.connect(hostEnd);
  const client = yield* Client.connect(clientEnd, { game });
  return { host, client, clientEnd };
});

/**
 * Lets `millis` of test time pass the way real time does: a little at a time, giving every fiber its turn. One jump would wake the host's loop once, to find all of it owed at once, as after a stall.
 */
const elapse = (millis: number) =>
  Effect.gen(function* () {
    for (let passed = 0; passed < millis; passed += 10) {
      yield* TestClock.adjust(`${Math.min(10, millis - passed)} millis`);
      yield* Effect.yieldNow;
    }
  });

const positionIn = (state: State.State, entity: State.Entity) =>
  Option.map(State.get(state, entity, Position), (position) => position.x);

describe('a session between a host and its clients', () => {
  it.effect('steps the state at its rate as time passes', () =>
    Effect.gen(function* () {
      const host = yield* startHost;

      yield* elapse(1000);

      const state = yield* host.state;
      expect(state.tick).toBe(30);
    }),
  );

  it.effect('welcomes a client with the entity it controls', () =>
    Effect.gen(function* () {
      const { host, client } = yield* session;
      const state = yield* host.state;

      expect(positionIn(state, client.entity)).toEqual(Option.some(0));
    }),
  );

  it.effect('moves a client’s entity by the demands it sends', () =>
    Effect.gen(function* () {
      const { host, client } = yield* session;

      yield* client.send([Controls.of({ move: 1, fire: false })]);
      yield* elapse(100);

      // Three steps of a thirtieth of a second, at 30 a second.
      const state = yield* host.state;
      expect(positionIn(state, client.entity)).toEqual(Option.some(3));
    }),
  );

  it.effect('shows the client the state the host stepped', () =>
    Effect.gen(function* () {
      const { host, client } = yield* session;

      yield* client.send([Controls.of({ move: 1, fire: false })]);
      yield* elapse(100);

      const seen = yield* client.state;
      const stepped = yield* host.state;
      expect(seen.tick).toBe(stepped.tick);
      expect(positionIn(seen, client.entity)).toEqual(positionIn(stepped, client.entity));
    }),
  );

  it.effect('tells a client which of its demands each state took in, by their numbers', () =>
    Effect.gen(function* () {
      const { host, client } = yield* session;

      const first = yield* client.send([Controls.of({ move: 1, fire: false })]);
      yield* elapse(100);
      const second = yield* client.send([Controls.of({ move: 0, fire: false })]);
      const before = yield* client.state;
      yield* elapse(100);
      const after = yield* client.state;

      expect([first, second]).toEqual([1, 2]);
      expect(client.ackedAt(before.tick)).toEqual(Option.some(1));
      expect(client.ackedAt(after.tick)).toEqual(Option.some(2));
      expect((yield* host.state).tick).toBe(after.tick);
    }),
  );

  it.effect('ignores what a client sends for anything but a demand', () =>
    Effect.gen(function* () {
      const { host, client, clientEnd } = yield* session;

      // A client sending a position for itself, as a cheat would.
      yield* clientEnd.send({
        channel: 'unreliable',
        payload: JSON.stringify({ demands: [{ seq: 99, values: { Position: { x: 999 } } }] }),
      });
      yield* elapse(100);

      const state = yield* host.state;
      expect(positionIn(state, client.entity)).toEqual(Option.some(0));
    }),
  );

  it.effect('lets a client go when its connection ends', () =>
    Effect.gen(function* () {
      const host = yield* startHost;
      const [, hostEnd] = yield* Transport.memoryPair;
      const scope = yield* Scope.make();

      const entity = yield* host.connect(hostEnd).pipe(Scope.provide(scope));
      yield* Scope.close(scope, Exit.void);

      const state = yield* host.state;
      expect(positionIn(state, entity)).toEqual(Option.none());
    }),
  );

  it.effect('keeps a demand across steps that bring no new one', () =>
    Effect.gen(function* () {
      const { host, client } = yield* session;

      yield* client.send([Controls.of({ move: -1, fire: false })]);
      yield* elapse(1000);

      const state = yield* host.state;
      expect(positionIn(state, client.entity)).toEqual(Option.some(-30));
    }),
  );

  it.effect('tells the client the rate its host steps at', () =>
    Effect.gen(function* () {
      const { client } = yield* session;

      expect(client.stepRate).toBe(30);
    }),
  );

  it.effect('hands on every newer state the client receives, in order', () =>
    Effect.gen(function* () {
      const { client } = yield* session;
      const received = yield* client.states.pipe(
        Stream.take(3),
        Stream.runCollect,
        Effect.forkChild,
      );

      yield* elapse(200);

      const states = yield* Fiber.join(received);
      expect(states.map((state) => state.tick)).toEqual([1, 2, 3]);
    }),
  );

  describe('suspending time', () => {
    it.effect('suspends time while a client asks, where the host allows it', () =>
      Effect.gen(function* () {
        const { host, client } = yield* session;

        yield* client.suspend;
        yield* elapse(1000);
        const suspended = yield* host.state;
        expect(suspended.tick).toBe(0);

        yield* client.resume;
        yield* elapse(100);
        // Three steps, not the thirty the suspended second would have owed.
        const resumed = yield* host.state;
        expect(resumed.tick).toBe(3);
      }),
    );

    it.effect('refuses to suspend time where the host does not allow it', () =>
      Effect.gen(function* () {
        const host = yield* Host.make(hostOptions(false));
        const [clientEnd, hostEnd] = yield* Transport.memoryPair;
        yield* host.connect(hostEnd);
        const client = yield* Client.connect(clientEnd, { game });

        yield* client.suspend;
        yield* elapse(1000);

        const state = yield* host.state;
        expect(state.tick).toBe(30);
      }),
    );

    it.effect('resumes time when the client suspending it leaves', () =>
      Effect.gen(function* () {
        const host = yield* startHost;
        const [clientEnd, hostEnd] = yield* Transport.memoryPair;
        const scope = yield* Scope.make();
        yield* host.connect(hostEnd).pipe(Scope.provide(scope));
        const client = yield* Client.connect(clientEnd, { game });

        yield* client.suspend;
        yield* elapse(500);
        yield* Scope.close(scope, Exit.void);
        yield* elapse(100);

        const state = yield* host.state;
        expect(state.tick).toBe(3);
      }),
    );
  });

  describe('actions', () => {
    const healthOf = (state: State.State, entity: State.Entity) =>
      Option.map(State.get(state, entity, Health), (health) => health.current);

    it.effect('hands a client’s action to the rules, as from the player who sent it', () =>
      Effect.gen(function* () {
        const { host, client } = yield* session;

        yield* client.act(AskedToHeal, { amount: 50 });
        yield* elapse(50);

        const state = yield* host.state;
        expect(healthOf(state, client.entity)).toEqual(Option.some(50));
      }),
    );

    it.effect('keeps a client’s actions in the order it sent them', () =>
      Effect.gen(function* () {
        const { host, client } = yield* session;

        yield* client.act(AskedToHeal, { amount: 50 });
        yield* client.act(AskedToHeal, { amount: 70 });
        yield* elapse(50);

        const state = yield* host.state;
        expect(healthOf(state, client.entity)).toEqual(Option.some(70));
      }),
    );

    it.effect('ignores an action the host does not know', () =>
      Effect.gen(function* () {
        const { host, client, clientEnd } = yield* session;

        yield* clientEnd.send({
          channel: 'reliable',
          payload: JSON.stringify({ _tag: 'Act', action: { _tag: 'Teleport', x: 1 } }),
        });
        yield* elapse(50);

        const state = yield* host.state;
        expect(healthOf(state, client.entity)).toEqual(Option.some(0));
      }),
    );

    it.effect('carries out an action sent while time is suspended once it runs again', () =>
      Effect.gen(function* () {
        const { host, client } = yield* session;

        yield* client.suspend;
        yield* client.act(AskedToHeal, { amount: 50 });
        yield* elapse(500);
        const suspended = yield* host.state;
        expect(healthOf(suspended, client.entity)).toEqual(Option.some(0));

        yield* client.resume;
        yield* elapse(50);
        const resumed = yield* host.state;
        expect(healthOf(resumed, client.entity)).toEqual(Option.some(50));
      }),
    );
  });
});

describe('watching a host', () => {
  it.effect(
    'tells the state as it is, then every client joining and leaving and every step taken with what went into it, in order',
    () =>
      Effect.gen(function* () {
        const host = yield* startHost;
        yield* elapse(100);
        const watching = yield* host.watch;
        const told = yield* watching.happenings.pipe(
          Stream.takeUntil((happening) => happening._tag === 'Left'),
          Stream.runCollect,
          Effect.forkChild,
        );
        const [clientEnd, hostEnd] = yield* Transport.memoryPair;
        const scope = yield* Scope.make();
        const entity = yield* host.connect(hostEnd).pipe(Scope.provide(scope));
        const client = yield* Client.connect(clientEnd, { game }).pipe(Scope.provide(scope));

        yield* client.send([Controls.of({ move: 1, fire: false })]);
        yield* client.act(AskedToHeal, { amount: 50 });
        yield* elapse(100);
        yield* Scope.close(scope, Exit.void);
        const happenings = yield* Fiber.join(told);

        expect(watching.state.tick).toBe(3);
        const [joined, firstStep, ...rest] = happenings;
        expect(joined).toEqual({ _tag: 'Joined', entity, client: true });
        expect(
          firstStep?._tag === 'Stepped' && {
            tick: firstStep.state.tick,
            demands: firstStep.input.demands.map((demand) => [
              demand.entity,
              demand.component.name,
              demand.encoded(),
            ]),
            actions: firstStep.input.actions,
          },
        ).toEqual({
          tick: 4,
          demands: [[entity, 'Controls', { move: 1, fire: false }]],
          actions: [{ _tag: 'AskedToHeal', amount: 50, player: entity }],
        });
        expect(rest.at(-1)).toEqual({ _tag: 'Left', entity });
        expect(rest.slice(0, -1).map((happening) => happening._tag)).toEqual([
          'Stepped',
          'Stepped',
        ]);
      }),
  );
});

describe('going back in time', () => {
  it.effect(
    'shows its clients a state it does not hold, such as a past one, and holds its own',
    () =>
      Effect.gen(function* () {
        const { host, client } = yield* session;
        yield* client.send([Controls.of({ move: 1, fire: false })]);
        yield* elapse(100);
        const past = yield* host.state;
        yield* elapse(200);
        const now = yield* host.state;

        yield* host.show(past);
        yield* Effect.yieldNow;

        expect((yield* client.state).tick).toBe(past.tick);
        expect(positionIn(yield* client.state, client.entity)).toEqual(
          positionIn(past, client.entity),
        );
        expect(yield* host.state).toBe(now);
      }),
  );

  it.effect('goes back to a state it is given, and steps on from there', () =>
    Effect.gen(function* () {
      const { host, client } = yield* session;
      yield* client.send([Controls.of({ move: 1, fire: false })]);
      yield* elapse(100);
      const past = yield* host.state;
      yield* elapse(200);

      yield* host.restore(past);
      yield* elapse(100);

      const state = yield* host.state;
      expect(state.tick).toBe(past.tick + 3);
      expect((yield* client.state).tick).toBe(state.tick);
    }),
  );

  it.effect('is told to whoever watches it', () =>
    Effect.gen(function* () {
      const host = yield* startHost;
      yield* elapse(100);
      const past = yield* host.state;
      yield* elapse(100);
      const watching = yield* host.watch;
      const told = yield* watching.happenings.pipe(
        Stream.filter((happening) => happening._tag === 'Restored'),
        Stream.runHead,
        Effect.forkChild,
      );
      yield* Effect.yieldNow;

      yield* host.restore(past);

      expect(yield* Fiber.join(told)).toEqual(Option.some({ _tag: 'Restored', state: past }));
    }),
  );
});

describe('reloading a game', () => {
  /** The game, but moving twice as far by the same stick. */
  const brisk = Game.make({
    stepRate: 30,
    domains: [
      Domain.make({
        name: 'Test',
        requires: [],
        components: [Position, Controls, Health],
        actions: [AskedToHeal],
        events: [],
        systems: [
          System.make({
            name: 'steer',
            reads: [Controls],
            writes: [Position],
            emits: [],
            run: (context) => {
              for (const [entity, position, controls] of context.query(Position, Controls)) {
                context.set(entity, Position, {
                  x: position.x + controls.move * 60 * context.time.secondsPerStep,
                });
              }
            },
          }),
        ],
        rules: [heal],
      }),
    ],
  });
  /** A game that holds nothing of health, so cannot read a state that does. */
  const unhealthy = Game.make({
    stepRate: 30,
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
  const setupOf = (played: Host.Options['game']) => ({ ...hostOptions(true), game: played });

  it.effect('plays on with the new game from the state it holds', () =>
    Effect.gen(function* () {
      const { host, client } = yield* session;
      yield* client.send([Controls.of({ move: 1, fire: false })]);
      yield* elapse(100);
      const before = yield* host.state;

      yield* host.reload(setupOf(brisk));
      yield* elapse(100);

      const after = yield* host.state;
      expect(after.tick).toBe(before.tick + 3);
      expect(positionIn(after, client.entity)).toEqual(
        Option.map(positionIn(before, client.entity), (x) => x + 6),
      );
    }),
  );

  it.effect('refuses a game that cannot read the state it holds, and plays on as it was', () =>
    Effect.gen(function* () {
      const { host, client } = yield* session;
      yield* client.send([Controls.of({ move: 1, fire: false })]);
      yield* elapse(100);
      const before = yield* host.state;

      const refused = yield* host.reload(setupOf(unhealthy)).pipe(Effect.flip);
      yield* elapse(100);

      expect(refused._tag).toBe('Unreadable');
      expect(positionIn(yield* host.state, client.entity)).toEqual(
        Option.map(positionIn(before, client.entity), (x) => x + 3),
      );
    }),
  );

  it.effect('is told to whoever watches it, with the state the new game read', () =>
    Effect.gen(function* () {
      const host = yield* startHost;
      yield* elapse(100);
      const watching = yield* host.watch;
      const told = yield* watching.happenings.pipe(Stream.runHead, Effect.forkChild);
      yield* Effect.yieldNow;

      yield* host.reload(setupOf(brisk));

      const happening = yield* Fiber.join(told);
      expect(Option.map(happening, ({ _tag }) => _tag)).toEqual(Option.some('Reloaded'));
      expect(
        Option.map(happening, (reloaded) => reloaded._tag === 'Reloaded' && reloaded.game),
      ).toEqual(Option.some(brisk));
    }),
  );
});

describe('time suspended beside the host', () => {
  it.effect(
    'stands while suspended, steps only as far as it is told, and runs on once resumed',
    () =>
      Effect.gen(function* () {
        const { host, client } = yield* session;
        yield* client.send([Controls.of({ move: 1, fire: false })]);
        yield* elapse(100);

        yield* host.suspend;
        const suspended = yield* host.state;
        yield* elapse(500);
        const stood = yield* host.state;
        yield* host.step(4);
        const stepped = yield* host.state;
        yield* host.resume;
        yield* elapse(100);

        expect(stood.tick).toBe(suspended.tick);
        expect(stepped.tick).toBe(suspended.tick + 4);
        expect(positionIn(stepped, client.entity)).toEqual(
          Option.map(positionIn(suspended, client.entity), (x) => x + 4),
        );
        expect((yield* client.state).tick).toBeGreaterThan(stepped.tick);
        expect((yield* host.state).tick).toBe(stepped.tick + 3);
      }),
  );
});

describe('playing from beside the host', () => {
  it.effect('takes demands on an entity, read by its component, over what its client sends', () =>
    Effect.gen(function* () {
      const { host, client } = yield* session;
      yield* host.suspend;
      yield* client.send([Controls.of({ move: 1, fire: false })]);
      yield* elapse(10);
      const before = yield* host.state;

      yield* host.demand(client.entity, [
        { component: 'Controls', value: { move: -2, fire: false } },
      ]);
      yield* host.step(1);

      expect(positionIn(yield* host.state, client.entity)).toEqual(
        Option.map(positionIn(before, client.entity), (x) => x - 2),
      );
    }),
  );

  it.effect('takes an action as from the player of an entity', () =>
    Effect.gen(function* () {
      const { host, client } = yield* session;
      yield* host.suspend;

      yield* host.act(client.entity, { _tag: 'AskedToHeal', amount: 42 });
      yield* host.step(1);

      expect(State.get(yield* host.state, client.entity, Health)).toEqual(
        Option.some({ current: 42 }),
      );
    }),
  );

  it.effect('joins players with no client, plays each, and lets them go, as watching tells', () =>
    Effect.gen(function* () {
      const host = yield* startHost;
      yield* host.suspend;
      const watching = yield* host.watch;
      const told = yield* watching.happenings.pipe(
        Stream.filter(({ _tag }) => _tag !== 'Stepped'),
        Stream.take(3),
        Stream.runCollect,
        Effect.forkChild,
      );
      yield* Effect.yieldNow;

      const first = yield* host.join;
      const second = yield* host.join;
      yield* host.demand(first, [{ component: 'Controls', value: { move: 1, fire: false } }]);
      yield* host.demand(second, [{ component: 'Controls', value: { move: -1, fire: false } }]);
      yield* host.step(1);
      const played = yield* host.state;
      yield* host.leave(first);

      expect([positionIn(played, first), positionIn(played, second)]).toEqual([
        Option.some(1),
        Option.some(-1),
      ]);
      expect(positionIn(yield* host.state, first)).toEqual(Option.none());
      expect(yield* Fiber.join(told)).toEqual([
        { _tag: 'Joined', entity: first, client: false },
        { _tag: 'Joined', entity: second, client: false },
        { _tag: 'Left', entity: first },
      ]);
    }),
  );

  it.effect(
    'refuses what the game cannot read: no demand component, no value of it, no action',
    () =>
      Effect.gen(function* () {
        const { host, client } = yield* session;
        const refusal = (attempt: Effect.Effect<void, Host.Unreadable>) =>
          attempt.pipe(
            Effect.match({ onFailure: ({ reason }) => reason, onSuccess: () => 'taken' }),
          );

        const reasons = [
          yield* refusal(host.demand(client.entity, [{ component: 'Position', value: { x: 9 } }])),
          yield* refusal(
            host.demand(client.entity, [{ component: 'Controls', value: { move: 'far' } }]),
          ),
          yield* refusal(host.act(client.entity, { _tag: 'Flew' })),
        ];

        expect(reasons).toEqual([
          'Position is no demand of the game',
          expect.stringContaining('Controls'),
          'Flew is no action a player of the game takes, or not one like it',
        ]);
      }),
  );
});

describe('controls', () => {
  it.effect('reach whatever listens beside the host, from the client that sent them', () =>
    Effect.gen(function* () {
      const { host, client } = yield* session;
      const heard = yield* host.controls.pipe(Stream.runHead, Effect.forkChild);
      yield* Effect.yieldNow;

      yield* client.control({ _tag: 'Seek', tick: 5 });

      expect(yield* Fiber.join(heard)).toEqual(
        Option.some({ entity: client.entity, payload: { _tag: 'Seek', tick: 5 } }),
      );
    }),
  );

  it.effect('reach nothing from a host that lets no client suspend time', () =>
    Effect.gen(function* () {
      const host = yield* Host.make(hostOptions(false));
      const [clientEnd, hostEnd] = yield* Transport.memoryPair;
      yield* host.connect(hostEnd);
      const client = yield* Client.connect(clientEnd, { game });
      const heard = yield* host.controls.pipe(Stream.runHead, Effect.forkChild);
      yield* Effect.yieldNow;

      yield* client.control({ _tag: 'Seek', tick: 5 });
      yield* elapse(100);

      expect(heard.pollUnsafe()).toBeUndefined();
    }),
  );
});

describe('questions', () => {
  /** Why a question went unanswered; that it was answered, if it was. */
  const reasonOf = (asking: Effect.Effect<unknown, Client.Unanswered>) =>
    asking.pipe(
      Effect.as('answered'),
      Effect.catchTag('Unanswered', ({ reason }) => Effect.succeed(reason)),
    );

  it.effect('are answered by whatever answers beside the host, knowing which player asked', () =>
    Effect.gen(function* () {
      const { host, client } = yield* session;
      yield* host.answering((question, entity) =>
        Effect.succeed({ heard: question, from: entity }),
      );

      const answer = yield* client.ask({ _tag: 'Span' });

      expect(answer).toEqual({ heard: { _tag: 'Span' }, from: client.entity });
    }),
  );

  it.effect('go unanswered with nothing to answer them, or what refused them', () =>
    Effect.gen(function* () {
      const { host, client } = yield* session;
      const unanswered = yield* reasonOf(client.ask({ _tag: 'Span' }));
      const scope = yield* Scope.make();
      yield* host.answering(() => Effect.fail('Nothing is kept yet.')).pipe(Scope.provide(scope));
      const refused = yield* reasonOf(client.ask({ _tag: 'Span' }));

      expect(unanswered).toBe('Nothing beside the host answers questions.');
      expect(refused).toBe('Nothing is kept yet.');
    }),
  );

  it.effect('go unanswered by a host that lets no client suspend time', () =>
    Effect.gen(function* () {
      const host = yield* Host.make(hostOptions(false));
      const [clientEnd, hostEnd] = yield* Transport.memoryPair;
      yield* host.connect(hostEnd);
      const client = yield* Client.connect(clientEnd, { game });
      yield* host.answering(() => Effect.succeed('an answer'));

      const unanswered = yield* reasonOf(client.ask({ _tag: 'Span' }));

      expect(unanswered).toBe('This host answers no client’s questions.');
    }),
  );
});

describe('commands', () => {
  /** Where health is kept outside the state: it says whether it kept an amount, or breaks. */
  const Vault = Context.Service<{ readonly keep: (amount: number) => Effect.Effect<boolean> }>(
    'Vault',
  );
  const KeptHealth = Command.result('KeptHealth', { player: Schema.Int });
  const FailedToKeepHealth = Command.result('FailedToKeepHealth', { player: Schema.Int });
  const KeepHealth = Command.make('KeepHealth', {
    args: { player: Schema.Int, amount: Schema.Int },
    results: [KeptHealth, FailedToKeepHealth],
    execute: ({ player, amount }) =>
      Effect.gen(function* () {
        const vault = yield* Vault;
        const kept = yield* vault.keep(amount);
        const done: Rule.ValueOf<typeof KeptHealth> = { _tag: 'KeptHealth', player };
        const failed: Rule.ValueOf<typeof FailedToKeepHealth> = {
          _tag: 'FailedToKeepHealth',
          player,
        };
        return kept ? done : failed;
      }),
  });
  const Kept = Component.make(
    'Kept',
    Schema.Union([Schema.TaggedStruct('Yes', {}), Schema.TaggedStruct('No', {})]),
    { owner: 'rules', network: 'server' },
  );
  const keepGame = Game.make({
    stepRate: 30,
    domains: [
      Domain.make({
        name: 'Keeping',
        requires: [],
        components: [Health, Kept],
        actions: [AskedToHeal],
        events: [],
        commands: [KeepHealth],
        systems: [],
        rules: [
          Rule.on(AskedToHeal, {
            reads: [],
            writes: [Health],
            emits: [],
            commands: [KeepHealth],
            run: (context, asked) => {
              context.set(asked.player, Health, { current: asked.amount });
              context.command(KeepHealth.of({ player: asked.player, amount: asked.amount }));
            },
          }),
          Rule.on(KeptHealth, {
            reads: [],
            writes: [Kept],
            emits: [],
            run: (context, kept) => context.set(kept.player, Kept, { _tag: 'Yes' }),
          }),
          Rule.on(FailedToKeepHealth, {
            reads: [],
            writes: [Kept],
            emits: [],
            run: (context, failed) => context.set(failed.player, Kept, { _tag: 'No' }),
          }),
        ],
      }),
    ],
  });
  const keeping = (vault: { readonly keep: (amount: number) => Effect.Effect<boolean> }) =>
    Effect.gen(function* () {
      const host = yield* Host.make({
        game: keepGame,
        state: State.empty({ seed: 1 }),
        join: (state) => State.spawn(state, [Health.of({ current: 0 })]),
        leave: State.despawn,
        maySuspend: false,
      });
      const [clientEnd, hostEnd] = yield* Transport.memoryPair;
      yield* host.connect(hostEnd);
      const client = yield* Client.connect(clientEnd, { game: keepGame });
      return { host, client, clientEnd };
    }).pipe(Effect.provideService(Vault, vault));
  const keptIn = (state: State.State, entity: State.Entity) =>
    Option.map(State.get(state, entity, Kept), ({ _tag }) => _tag);
  const healthIn = (state: State.State, entity: State.Entity) =>
    Option.map(State.get(state, entity, Health), ({ current }) => current);

  it('needs the services the game’s commands need', () => {
    const hosting = Host.make({
      game: keepGame,
      state: State.empty({ seed: 1 }),
      join: (state) => State.spawn(state, [Health.of({ current: 0 })]),
      leave: State.despawn,
      maySuspend: false,
    });
    // Both the type checker and Effect's own check refuse it: hosting a game that keeps health needs a vault to keep it in.
    // @ts-expect-error The vault is not given.
    // @effect-diagnostics-next-line missingEffectContext:off
    const unprovided: Effect.Effect<Host.Host, never, Scope.Scope> = hosting;

    expect(unprovided).toBe(hosting);
  });

  it.effect(
    'runs what the rules issue with the host’s services, its result handled a step later',
    () =>
      Effect.gen(function* () {
        const kept: Array<number> = [];
        const { host, client } = yield* keeping({
          keep: (amount) => Effect.sync(() => kept.push(amount) > 0),
        });

        yield* client.act(AskedToHeal, { amount: 40 });
        yield* elapse(100);

        expect(kept).toEqual([40]);
        expect(keptIn(yield* host.state, client.entity)).toEqual(Option.some('Yes'));
      }),
  );

  it.effect('brings a failure it foresaw back as one of its results', () =>
    Effect.gen(function* () {
      const { host, client } = yield* keeping({ keep: () => Effect.succeed(false) });

      yield* client.act(AskedToHeal, { amount: 40 });
      yield* elapse(100);

      expect(keptIn(yield* host.state, client.entity)).toEqual(Option.some('No'));
    }),
  );

  it.effect('takes no result from a client, since only the host’s own commands bring one', () =>
    Effect.gen(function* () {
      const { host, client, clientEnd } = yield* keeping({ keep: () => Effect.succeed(true) });

      yield* clientEnd.send({
        channel: 'reliable',
        payload: Protocol.encodeClientReliable({
          _tag: 'Act',
          action: { _tag: 'KeptHealth', player: client.entity },
        }),
      });
      const beside = yield* Effect.flip(
        host.act(client.entity, { _tag: 'KeptHealth', player: client.entity }),
      );
      yield* elapse(100);

      expect(beside.reason).toBe(
        'KeptHealth is no action a player of the game takes, or not one like it',
      );
      expect(keptIn(yield* host.state, client.entity)).toEqual(Option.none());
    }),
  );

  it.effect('goes on stepping when a command breaks, and the command has no result', () =>
    Effect.gen(function* () {
      const { host, client } = yield* keeping({ keep: () => Effect.die('the vault is gone') });

      yield* client.act(AskedToHeal, { amount: 40 });
      yield* elapse(100);
      const state = yield* host.state;

      expect(state.tick).toBeGreaterThan(2);
      expect(healthIn(state, client.entity)).toEqual(Option.some(40));
      expect(keptIn(state, client.entity)).toEqual(Option.none());
    }),
  );
});

describe('what a client keeps for itself', () => {
  /** A footprint left where something stands: each client's own. */
  const Footprint = Component.make('Footprint', Schema.Struct({ tick: Schema.Int }), {
    owner: 'simulation',
    network: 'local',
  });
  const tread = System.make({
    name: 'tread',
    reads: [Position],
    writes: [],
    emits: [],
    spawns: [Footprint],
    run: (context) => {
      for (const _ of context.query(Position)) {
        context.spawn([Footprint.of({ tick: context.time.tick })]);
      }
    },
  });
  const walking = Game.make({
    stepRate: 30,
    domains: [
      Domain.make({
        name: 'Walking',
        requires: [],
        components: [Position, Footprint],
        actions: [],
        events: [],
        systems: [],
        rules: [],
        localSystems: [tread],
      }),
    ],
  });
  const walk = Effect.gen(function* () {
    const host = yield* Host.make({
      game: walking,
      state: State.empty({ seed: 1 }),
      join: (state) => State.spawn(state, [Position.of({ x: 0 })]),
      leave: State.despawn,
      maySuspend: false,
    });
    const [clientEnd, hostEnd] = yield* Transport.memoryPair;
    yield* host.connect(hostEnd);
    const client = yield* Client.connect(clientEnd, { game: walking });
    return { host, client };
  });

  it.effect(
    'is stepped by the client at every tick the server reaches, and never by the server',
    () =>
      Effect.gen(function* () {
        const { host, client } = yield* walk;

        yield* elapse(200);
        const mine = yield* client.state;
        const prints = State.query(mine, Footprint);

        expect(State.query(yield* host.state, Footprint)).toEqual([]);
        expect(prints.length).toBeGreaterThan(3);
        expect(prints.every(([entity]) => State.isLocal(entity))).toBe(true);
        // One print a tick, ticks in order, none twice.
        const ticks = prints.map(([, { tick }]) => tick).toSorted((a, b) => a - b);
        expect(new Set(ticks).size).toBe(ticks.length);
        expect(ticks.at(-1)).toBe(mine.tick);
      }),
  );

  it.effect('is shown as the client kept it at the tick of a past state it is shown', () =>
    Effect.gen(function* () {
      const { host, client } = yield* walk;
      yield* elapse(100);
      const past = yield* host.state;
      const keptThen = State.query(yield* client.state, Footprint);
      yield* elapse(200);

      yield* host.show(past);
      yield* Effect.yieldNow;

      expect(State.query(yield* client.state, Footprint)).toEqual(keptThen);
    }),
  );
});
