import { describe, expect, it } from '@effect/vitest';
import { Context, Effect, Exit, Fiber, Option, Schema, Scope, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import * as Action from '#src/Action.ts';
import * as Client from '#src/Client.ts';
import * as Command from '#src/Command.ts';
import * as Component from '#src/Component.ts';
import { Controls, Health, Position } from '#src/fixtures.ts';
import * as Event from '#src/Event.ts';
import * as Game from '#src/Game.ts';
import * as Domain from '#src/Domain.ts';
import * as Host from '#src/Host.ts';
import * as Rule from '#src/Rule.ts';
import * as System from '#src/System.ts';
import * as Transport from '#src/Transport.ts';
import * as World from '#src/World.ts';

/** Moves every controlled entity by its stick, at 30 a second. */
const steer = System.make({
  name: 'steer',
  reads: [Controls],
  writes: [Position],
  emits: [],
  run: (context) => {
    for (const [entity, position, controls] of context.query(Position, Controls)) {
      context.set(entity, Position, {
        x: position.x + controls.move * 30 * context.time.stepSeconds,
      });
    }
  },
});

/** A player asked to be healed to an amount; the rules grant it to whoever asked. */
const AskedToHeal = Action.make('AskedToHeal', { amount: Schema.Int });
const heal = Rule.on(AskedToHeal, {
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

const hostOptions = (mayHold: boolean): Host.Options => ({
  game,
  world: World.empty({ seed: 1 }),
  join: (world) =>
    World.spawn(world, [
      Position.of({ x: 0 }),
      Controls.of({ move: 0, fire: false }),
      Health.of({ current: 0 }),
    ]),
  leave: World.despawn,
  mayHold,
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
const advance = (millis: number) =>
  Effect.gen(function* () {
    for (let passed = 0; passed < millis; passed += 10) {
      yield* TestClock.adjust(`${Math.min(10, millis - passed)} millis`);
      yield* Effect.yieldNow;
    }
  });

const positionIn = (world: World.World, entity: World.Entity) =>
  Option.map(World.get(world, entity, Position), (position) => position.x);

describe('a session between a host and its clients', () => {
  it.effect('steps the world at its rate as time passes', () =>
    Effect.gen(function* () {
      const host = yield* startHost;

      yield* advance(1000);

      const world = yield* host.world;
      expect(world.tick).toBe(30);
    }),
  );

  it.effect('welcomes a client with the entity it controls', () =>
    Effect.gen(function* () {
      const { host, client } = yield* session;
      const world = yield* host.world;

      expect(positionIn(world, client.entity)).toEqual(Option.some(0));
    }),
  );

  it.effect('moves a client’s entity by the input it sends', () =>
    Effect.gen(function* () {
      const { host, client } = yield* session;

      yield* client.send([Controls.of({ move: 1, fire: false })]);
      yield* advance(100);

      // Three steps of a thirtieth of a second, at 30 a second.
      const world = yield* host.world;
      expect(positionIn(world, client.entity)).toEqual(Option.some(3));
    }),
  );

  it.effect('shows the client the world the host stepped', () =>
    Effect.gen(function* () {
      const { host, client } = yield* session;

      yield* client.send([Controls.of({ move: 1, fire: false })]);
      yield* advance(100);

      const seen = yield* client.world;
      const stepped = yield* host.world;
      expect(seen.tick).toBe(stepped.tick);
      expect(positionIn(seen, client.entity)).toEqual(positionIn(stepped, client.entity));
    }),
  );

  it.effect('ignores what a client sends for anything but input', () =>
    Effect.gen(function* () {
      const { host, client, clientEnd } = yield* session;

      // A client sending a position for itself, as a cheat would.
      yield* clientEnd.send({
        channel: 'unreliable',
        payload: JSON.stringify({ inputs: [{ seq: 99, values: { Position: { x: 999 } } }] }),
      });
      yield* advance(100);

      const world = yield* host.world;
      expect(positionIn(world, client.entity)).toEqual(Option.some(0));
    }),
  );

  it.effect('lets a client go when its connection ends', () =>
    Effect.gen(function* () {
      const host = yield* startHost;
      const [, hostEnd] = yield* Transport.memoryPair;
      const scope = yield* Scope.make();

      const entity = yield* host.connect(hostEnd).pipe(Scope.provide(scope));
      yield* Scope.close(scope, Exit.void);

      const world = yield* host.world;
      expect(positionIn(world, entity)).toEqual(Option.none());
    }),
  );

  it.effect('keeps a held input across steps that bring no new one', () =>
    Effect.gen(function* () {
      const { host, client } = yield* session;

      yield* client.send([Controls.of({ move: -1, fire: false })]);
      yield* advance(1000);

      const world = yield* host.world;
      expect(positionIn(world, client.entity)).toEqual(Option.some(-30));
    }),
  );

  it.effect('tells the client the rate its host steps at', () =>
    Effect.gen(function* () {
      const { client } = yield* session;

      expect(client.stepRate).toBe(30);
    }),
  );

  it.effect('hands on every newer world the client receives, in order', () =>
    Effect.gen(function* () {
      const { client } = yield* session;
      const received = yield* client.worlds.pipe(
        Stream.take(3),
        Stream.runCollect,
        Effect.forkChild,
      );

      yield* advance(200);

      const worlds = yield* Fiber.join(received);
      expect(worlds.map((world) => world.tick)).toEqual([1, 2, 3]);
    }),
  );

  describe('holding time', () => {
    it.effect('holds time while a client asks, where the host allows it', () =>
      Effect.gen(function* () {
        const { host, client } = yield* session;

        yield* client.hold;
        yield* advance(1000);
        const held = yield* host.world;
        expect(held.tick).toBe(0);

        yield* client.release;
        yield* advance(100);
        // Three steps, not the thirty the held second would have owed.
        const resumed = yield* host.world;
        expect(resumed.tick).toBe(3);
      }),
    );

    it.effect('refuses to hold time where the host does not allow it', () =>
      Effect.gen(function* () {
        const host = yield* Host.make(hostOptions(false));
        const [clientEnd, hostEnd] = yield* Transport.memoryPair;
        yield* host.connect(hostEnd);
        const client = yield* Client.connect(clientEnd, { game });

        yield* client.hold;
        yield* advance(1000);

        const world = yield* host.world;
        expect(world.tick).toBe(30);
      }),
    );

    it.effect('lets time go when the client holding it leaves', () =>
      Effect.gen(function* () {
        const host = yield* startHost;
        const [clientEnd, hostEnd] = yield* Transport.memoryPair;
        const scope = yield* Scope.make();
        yield* host.connect(hostEnd).pipe(Scope.provide(scope));
        const client = yield* Client.connect(clientEnd, { game });

        yield* client.hold;
        yield* advance(500);
        yield* Scope.close(scope, Exit.void);
        yield* advance(100);

        const world = yield* host.world;
        expect(world.tick).toBe(3);
      }),
    );
  });

  describe('actions', () => {
    const healthOf = (world: World.World, entity: World.Entity) =>
      Option.map(World.get(world, entity, Health), (health) => health.current);

    it.effect('hands a client’s action to the rules, as from the player who sent it', () =>
      Effect.gen(function* () {
        const { host, client } = yield* session;

        yield* client.act(AskedToHeal, { amount: 50 });
        yield* advance(50);

        const world = yield* host.world;
        expect(healthOf(world, client.entity)).toEqual(Option.some(50));
      }),
    );

    it.effect('keeps a client’s actions in the order it sent them', () =>
      Effect.gen(function* () {
        const { host, client } = yield* session;

        yield* client.act(AskedToHeal, { amount: 50 });
        yield* client.act(AskedToHeal, { amount: 70 });
        yield* advance(50);

        const world = yield* host.world;
        expect(healthOf(world, client.entity)).toEqual(Option.some(70));
      }),
    );

    it.effect('ignores an action the host does not know', () =>
      Effect.gen(function* () {
        const { host, client, clientEnd } = yield* session;

        yield* clientEnd.send({
          channel: 'reliable',
          payload: JSON.stringify({ _tag: 'Act', action: { _tag: 'Teleport', x: 1 } }),
        });
        yield* advance(50);

        const world = yield* host.world;
        expect(healthOf(world, client.entity)).toEqual(Option.some(0));
      }),
    );

    it.effect('carries out an action sent while time is held once it runs again', () =>
      Effect.gen(function* () {
        const { host, client } = yield* session;

        yield* client.hold;
        yield* client.act(AskedToHeal, { amount: 50 });
        yield* advance(500);
        const held = yield* host.world;
        expect(healthOf(held, client.entity)).toEqual(Option.some(0));

        yield* client.release;
        yield* advance(50);
        const resumed = yield* host.world;
        expect(healthOf(resumed, client.entity)).toEqual(Option.some(50));
      }),
    );
  });
});

describe('watching a host', () => {
  it.effect(
    'tells the world as it is, then every client joining and leaving and every step taken with what went into it, in order',
    () =>
      Effect.gen(function* () {
        const host = yield* startHost;
        yield* advance(100);
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
        yield* advance(100);
        yield* Scope.close(scope, Exit.void);
        const happenings = yield* Fiber.join(told);

        expect(watching.world.tick).toBe(3);
        const [joined, firstStep, ...rest] = happenings;
        expect(joined).toEqual({ _tag: 'Joined', entity });
        expect(
          firstStep?._tag === 'Stepped' && {
            tick: firstStep.tick,
            inputs: firstStep.inputs.map((input) => [
              input.entity,
              input.component.name,
              input.encoded(),
            ]),
            actions: firstStep.actions,
          },
        ).toEqual({
          tick: 4,
          inputs: [[entity, 'Controls', { move: 1, fire: false }]],
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

describe('commands', () => {
  /** Where health is kept outside the world: it says whether it kept an amount, or breaks. */
  const Vault = Context.Service<{ readonly keep: (amount: number) => Effect.Effect<boolean> }>(
    'Vault',
  );
  const KeptHealth = Event.make('KeptHealth', { player: Schema.Int });
  const FailedToKeepHealth = Event.make('FailedToKeepHealth', { player: Schema.Int });
  const KeepHealth = Command.make('KeepHealth', {
    args: { player: Schema.Int, amount: Schema.Int },
    results: [KeptHealth, FailedToKeepHealth],
    execute: ({ player, amount }) =>
      Effect.gen(function* () {
        const vault = yield* Vault;
        const kept = yield* vault.keep(amount);
        const done: Event.ValueOf<typeof KeptHealth> = { _tag: 'KeptHealth', player };
        const failed: Event.ValueOf<typeof FailedToKeepHealth> = {
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
        events: [KeptHealth, FailedToKeepHealth],
        commands: [KeepHealth],
        systems: [],
        rules: [
          Rule.on(AskedToHeal, {
            writes: [Health],
            emits: [],
            commands: [KeepHealth],
            run: (context, asked) => {
              context.set(asked.player, Health, { current: asked.amount });
              context.command(KeepHealth.of({ player: asked.player, amount: asked.amount }));
            },
          }),
          Rule.on(KeptHealth, {
            writes: [Kept],
            emits: [],
            run: (context, kept) => context.set(kept.player, Kept, { _tag: 'Yes' }),
          }),
          Rule.on(FailedToKeepHealth, {
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
        world: World.empty({ seed: 1 }),
        join: (world) => World.spawn(world, [Health.of({ current: 0 })]),
        leave: World.despawn,
        mayHold: false,
      });
      const [clientEnd, hostEnd] = yield* Transport.memoryPair;
      yield* host.connect(hostEnd);
      const client = yield* Client.connect(clientEnd, { game: keepGame });
      return { host, client };
    }).pipe(Effect.provideService(Vault, vault));
  const keptIn = (world: World.World, entity: World.Entity) =>
    Option.map(World.get(world, entity, Kept), ({ _tag }) => _tag);
  const healthIn = (world: World.World, entity: World.Entity) =>
    Option.map(World.get(world, entity, Health), ({ current }) => current);

  it('needs the services the game’s commands need', () => {
    const hosting = Host.make({
      game: keepGame,
      world: World.empty({ seed: 1 }),
      join: (world) => World.spawn(world, [Health.of({ current: 0 })]),
      leave: World.despawn,
      mayHold: false,
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
        yield* advance(100);

        expect(kept).toEqual([40]);
        expect(keptIn(yield* host.world, client.entity)).toEqual(Option.some('Yes'));
      }),
  );

  it.effect('brings a failure it foresaw back as one of its results', () =>
    Effect.gen(function* () {
      const { host, client } = yield* keeping({ keep: () => Effect.succeed(false) });

      yield* client.act(AskedToHeal, { amount: 40 });
      yield* advance(100);

      expect(keptIn(yield* host.world, client.entity)).toEqual(Option.some('No'));
    }),
  );

  it.effect('goes on stepping when a command breaks, and the command has no result', () =>
    Effect.gen(function* () {
      const { host, client } = yield* keeping({ keep: () => Effect.die('the vault is gone') });

      yield* client.act(AskedToHeal, { amount: 40 });
      yield* advance(100);
      const world = yield* host.world;

      expect(world.tick).toBeGreaterThan(2);
      expect(healthIn(world, client.entity)).toEqual(Option.some(40));
      expect(keptIn(world, client.entity)).toEqual(Option.none());
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
      world: World.empty({ seed: 1 }),
      join: (world) => World.spawn(world, [Position.of({ x: 0 })]),
      leave: World.despawn,
      mayHold: false,
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

        yield* advance(200);
        const mine = yield* client.world;
        const prints = World.query(mine, Footprint);

        expect(World.query(yield* host.world, Footprint)).toEqual([]);
        expect(prints.length).toBeGreaterThan(3);
        expect(prints.every(([entity]) => World.isLocal(entity))).toBe(true);
        // One print a tick, ticks in order, none twice.
        const ticks = prints.map(([, { tick }]) => tick).toSorted((a, b) => a - b);
        expect(new Set(ticks).size).toBe(ticks.length);
        expect(ticks.at(-1)).toBe(mine.tick);
      }),
  );
});
