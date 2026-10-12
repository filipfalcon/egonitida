import { Component, Domain, Rule, System } from '@lightocean/core';
import { Option, Schema } from 'effect';
import * as Body from '#src/body.ts';
import * as Survivor from '#src/survivor.ts';

/**
 * The undead: they rise at the edge of the arena, ever faster the longer a survivor stands, shamble toward the nearest survivor, and bite whoever they reach. A survivor's shot fells the first one in line once it has taken as many shots as it has health; the fallen lie a while, then are gone.
 */

/** How long a survivor stands before the first zombie rises, in seconds. */
export const GRACE_SECONDS = 2;

/** How long between zombies rising when a survivor has just stood up, and how much shorter it gets every second they stand, never shorter than the least. */
const RISING = { first: 2, quickening: 0.075, least: 0.4 };

/** How close a zombie comes to a survivor, and how close it must be to bite, in metres. */
export const STOP = 0.6;
const REACH = 0.8;

/** What a bite takes from a survivor's health, and the seconds a zombie takes between bites. */
export const BITE_DAMAGE = 10;
const BITE_SECONDS = 1;

/** How far a shot flies, and how near its line a zombie must be to be hit, in metres. */
export const RANGE = 15;
const HIT_WIDTH = 0.45;

/** How long a fallen zombie lies before it is gone, in seconds. */
export const FALLEN_SECONDS = 3;

/** How close two zombies come before they jostle apart, in metres. */
const ELBOW_ROOM = 0.7;

// COMPONENTS

/** A zombie: shambling, with the shots it can still take, or fallen at a tick. */
export const Zombie = Component.make(
  'Zombie',
  Schema.Union([
    Schema.TaggedStruct('Shambling', { health: Schema.Int }),
    Schema.TaggedStruct('Fallen', { at: Schema.Int }),
  ]),
  { owner: 'rules', network: 'server' },
);

/** How fast a zombie shambles, in metres a second. */
export const Gait = Component.make('Gait', Schema.Struct({ speed: Schema.Finite }), {
  owner: 'simulation',
  network: 'server',
});

/** The tick from which a zombie may bite again. */
export const Jaws = Component.make('Jaws', Schema.Struct({ readyAt: Schema.Int }), {
  owner: 'simulation',
  network: 'server',
});

/** When the next zombie rises: the horde's one value that belongs to no zombie. */
export const Tide = Component.make('Tide', Schema.Struct({ nextAt: Schema.Int }), {
  owner: 'simulation',
  network: 'private',
});

const Point = Schema.Struct({ x: Schema.Finite, z: Schema.Finite });

/** A survivor's last shot: when it was fired, and where it flew from and to. */
export const LastShot = Component.make(
  'LastShot',
  Schema.Struct({ at: Schema.Int, from: Point, to: Point }),
  { owner: 'rules', network: 'server' },
);

/** What a zombie is made of as it rises at `x`, `z`: shambling, with `health` shots to take, at `speed`, and ready to bite. */
export const risen = (zombie: {
  readonly x: number;
  readonly z: number;
  readonly health: number;
  readonly speed: number;
}) => [
  Zombie.of({ _tag: 'Shambling', health: zombie.health }),
  Gait.of({ speed: zombie.speed }),
  Jaws.of({ readyAt: 0 }),
  Body.Position.of({ x: zombie.x, z: zombie.z }),
];

// RULES

/** A living survivor's shot hits the first shambling zombie near its line, which falls once it has no health left, and the kill is theirs. */
const shoot = Rule.on(Survivor.PulledTrigger, {
  writes: [Zombie, LastShot],
  emits: [Survivor.Killed],
  run: (context, { player }) => {
    const aiming = Option.all({
      life: Option.filter(context.get(player, Survivor.Life), ({ _tag }) => _tag === 'Alive'),
      from: context.get(player, Body.Position),
      stick: context.get(player, Survivor.Stick),
    });
    Option.map(aiming, ({ from, stick }) => {
      const along = { x: Math.cos(stick.aim), z: Math.sin(stick.aim) };
      const hit = context
        .query(Zombie, Body.Position)
        .reduce<
          Option.Option<{ readonly zombie: number; readonly health: number; readonly t: number }>
        >((nearest, [zombie, mode, { x, z }]) => {
          const t = (x - from.x) * along.x + (z - from.z) * along.z;
          const aside = Math.abs((x - from.x) * along.z - (z - from.z) * along.x);
          const inLine = mode._tag === 'Shambling' && t > 0 && t <= RANGE && aside <= HIT_WIDTH;
          return inLine && Option.match(nearest, { onNone: () => true, onSome: (n) => t < n.t })
            ? Option.some({ zombie, health: mode.health, t })
            : nearest;
        }, Option.none());
      const t = Option.match(hit, { onNone: () => RANGE, onSome: (found) => found.t });
      context.set(player, LastShot, {
        at: context.time.tick,
        from,
        to: { x: from.x + along.x * t, z: from.z + along.z * t },
      });
      Option.map(hit, ({ zombie, health }) => {
        if (health > 1) {
          context.set(zombie, Zombie, { _tag: 'Shambling', health: health - 1 });
          return;
        }
        context.set(zombie, Zombie, { _tag: 'Fallen', at: context.time.tick });
        context.emit({ _tag: 'Killed', survivor: player });
      });
    });
  },
});

/** A survivor rising again finds the arena cleared of the horde. */
const clear = Rule.on(Survivor.Revived, {
  writes: [],
  emits: [],
  despawns: true,
  run: (context) => {
    for (const [zombie] of context.query(Zombie)) {
      context.despawn(zombie);
    }
  },
});

// SYSTEMS

/** Once a survivor has stood a while, zombies rise one at a time at a random point on the arena's edge, ever more often. */
const rise = System.make({
  name: 'rise',
  reads: [Survivor.Life],
  writes: [Tide],
  emits: [],
  spawns: [Zombie, Gait, Jaws, Body.Position],
  run: (context) => {
    const { tick, secondsPerStep } = context.time;
    const stood = context
      .query(Survivor.Life)
      .flatMap(([, life]) => (life._tag === 'Alive' ? [(tick - life.since) * secondsPerStep] : []));
    if (stood.length === 0) {
      return;
    }
    const longest = Math.max(...stood);
    for (const [tide, { nextAt }] of context.query(Tide)) {
      if (longest >= GRACE_SECONDS && tick >= nextAt) {
        const angle = context.random() * Math.PI * 2;
        context.spawn(
          risen({
            x: Math.cos(angle) * Body.ARENA_RADIUS,
            z: Math.sin(angle) * Body.ARENA_RADIUS,
            health: 1 + Math.floor(context.random() * 3),
            speed: 0.8 + context.random() * 0.8,
          }),
        );
        const wait = Math.max(RISING.least, RISING.first - RISING.quickening * longest);
        context.set(tide, Tide, { nextAt: tick + Math.round(wait / secondsPerStep) });
      }
    }
  },
});

/** A shambling zombie heads for the nearest living survivor, stopping short of them, and keeps its elbow room from the others. */
const shamble = System.make({
  name: 'shamble',
  reads: [Zombie, Gait, Survivor.Life],
  writes: [Body.Position],
  emits: [],
  run: (context) => {
    const survivors = context
      .query(Survivor.Life, Body.Position)
      .flatMap(([, life, position]) => (life._tag === 'Alive' ? [position] : []));
    const walkers = context
      .query(Zombie, Gait, Body.Position)
      .filter(([, mode]) => mode._tag === 'Shambling');
    for (const [zombie, , { speed }, { x, z }] of walkers) {
      const target = survivors.reduce<Option.Option<{ readonly x: number; readonly z: number }>>(
        (nearest, one) =>
          Option.match(nearest, {
            onNone: () => Option.some(one),
            onSome: (n) =>
              Math.hypot(one.x - x, one.z - z) < Math.hypot(n.x - x, n.z - z)
                ? Option.some(one)
                : nearest,
          }),
        Option.none(),
      );
      const pull = Option.match(target, {
        onNone: () => ({ x: 0, z: 0 }),
        onSome: (to) => {
          const distance = Math.hypot(to.x - x, to.z - z);
          const step = Math.min(speed * context.time.secondsPerStep, Math.max(distance - STOP, 0));
          return distance === 0
            ? { x: 0, z: 0 }
            : { x: ((to.x - x) / distance) * step, z: ((to.z - z) / distance) * step };
        },
      });
      const push = walkers.reduce(
        (sum, [other, , , at]) => {
          const distance = Math.hypot(x - at.x, z - at.z);
          if (other === zombie || distance >= ELBOW_ROOM || distance === 0) {
            return sum;
          }
          const away = ((ELBOW_ROOM - distance) / distance) * 0.5;
          return { x: sum.x + (x - at.x) * away, z: sum.z + (z - at.z) * away };
        },
        { x: 0, z: 0 },
      );
      if (pull.x !== 0 || pull.z !== 0 || push.x !== 0 || push.z !== 0) {
        context.set(zombie, Body.Position, { x: x + pull.x + push.x, z: z + pull.z + push.z });
      }
    }
  },
});

/** A shambling zombie within reach of a living survivor bites them, then takes a while before it bites again. */
const bite = System.make({
  name: 'bite',
  reads: [Zombie, Survivor.Life, Body.Position],
  writes: [Jaws],
  emits: [Survivor.Bitten],
  run: (context) => {
    const { tick, secondsPerStep } = context.time;
    const survivors = context
      .query(Survivor.Life, Body.Position)
      .filter(([, life]) => life._tag === 'Alive');
    for (const [zombie, mode, { readyAt }, { x, z }] of context.query(
      Zombie,
      Jaws,
      Body.Position,
    )) {
      const reached = survivors.find(([, , at]) => Math.hypot(at.x - x, at.z - z) <= REACH);
      if (mode._tag === 'Shambling' && tick >= readyAt && reached !== undefined) {
        context.emit({ _tag: 'Bitten', survivor: reached[0], damage: BITE_DAMAGE });
        context.set(zombie, Jaws, { readyAt: tick + Math.round(BITE_SECONDS / secondsPerStep) });
      }
    }
  },
});

/** A fallen zombie is gone once it has lain a while. */
const rot = System.make({
  name: 'rot',
  reads: [Zombie],
  writes: [],
  emits: [],
  despawns: true,
  run: (context) => {
    const { tick, secondsPerStep } = context.time;
    for (const [zombie, mode] of context.query(Zombie)) {
      if (mode._tag === 'Fallen' && (tick - mode.at) * secondsPerStep >= FALLEN_SECONDS) {
        context.despawn(zombie);
      }
    }
  },
});

// DOMAIN

export const domain = Domain.make({
  name: 'Horde',
  requires: [Body.domain, Survivor.domain],
  components: [Zombie, Gait, Jaws, Tide, LastShot],
  actions: [],
  events: [],
  systems: [rise, shamble, bite, rot],
  rules: [shoot, clear],
});
