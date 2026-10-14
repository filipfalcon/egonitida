import { Option, Schema } from 'effect';
import type * as Ray from '#src/Ray.ts';

/**
 * A body falling limp, as plain data: points at its joints, each as round and as heavy as the flesh about it, held at the distances they started at, some held together as one, some joints bending only one way, falling under gravity onto the floor and against the walls, soft, so what lands soaks up its tumbling, until it lies still. The game names its points and how they hold together, since only it knows its bodies; the distances come from the pose it starts in, so a body shaped longer falls longer. It is stepped as a system steps anything, the same start falling the same way every time, so a replay falls as the game did; a client keeps it as a local component, stepped by a local system, as only it draws it.
 */

/** A point, or a direction, in metres. */
export interface Point {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** How round the flesh about a point is, in metres, and how heavy, in kilograms: the heavier, the less it gives way when held to another. */
export interface Flesh {
  readonly radius: number;
  readonly mass: number;
}

/** Which way a hinge bends: from the first of two points to the second; or ahead of a part held together as one, such as a trunk, the way from across it, its first point to its second, turned about the way up it, such as the way from her right hip to her left about her spine, which no bending of the hinge turns. */
export type Toward<P extends string> =
  | readonly [P, P]
  | { readonly across: readonly [P, P]; readonly up: readonly [P, P] };

/** A joint that bends only one way, such as a knee: `joint` stays on the side of the line from `from` to `to` that `toward` points. */
export interface Hinge<P extends string> {
  readonly from: P;
  readonly joint: P;
  readonly to: P;
  readonly toward: Toward<P>;
}

/** How a game's bodies fall: their points, by the names the game gives them, how each pair of `links` holds together, which groups of `rigid` hold together as one, and which `hinges` bend only one way. */
export interface Spec<P extends string> {
  readonly points: { readonly [Name in P]: Flesh };
  readonly links: ReadonlyArray<readonly [P, P]>;
  readonly rigid: ReadonlyArray<ReadonlyArray<P>>;
  readonly hinges: ReadonlyArray<Hinge<P>>;
}

/** How a game's bodies fall, made by `plan`: its points in order, and each rule holding them, by the points' places in that order. */
export interface Plan<P extends string> {
  readonly names: ReadonlyArray<P>;
  readonly radius: ReadonlyArray<number>;
  readonly lightness: ReadonlyArray<number>;
  /** Every pair held at the distance it started at: the links, then every pair of each rigid group. */
  readonly pairs: ReadonlyArray<readonly [number, number]>;
  /** The points of each group held together as one. */
  readonly rigid: ReadonlyArray<ReadonlyArray<number>>;
  readonly hinges: ReadonlyArray<{
    readonly from: number;
    readonly joint: number;
    readonly to: number;
    readonly across: readonly [number, number];
    readonly up: readonly [number, number] | undefined;
  }>;
  readonly place: ReadonlyMap<P, number>;
}

/** What a body falls among: the height of the floor, and the walls, boxes square to the axes. */
export interface Surroundings {
  readonly floor: number;
  readonly walls: ReadonlyArray<Ray.Box>;
}

/** A body falling: where each of its points is now and was a moment before, three numbers each, in its plan's order, which is how it moves; how far apart each pair of its plan is held; how many seconds nothing of it has moved; and whether it lies still. */
export const Body = Schema.Struct({
  now: Schema.Array(Schema.Finite),
  before: Schema.Array(Schema.Finite),
  lengths: Schema.Array(Schema.Finite),
  quiet: Schema.Finite,
  still: Schema.Boolean,
});
export type Body = typeof Body.Type;

/** How a body of `spec` falls. */
export const plan = <const P extends string>(spec: Spec<P>): Plan<P> => {
  const names = Object.keys(spec.points).filter((name): name is P => name in spec.points);
  const place = new Map(names.map((name, index) => [name, index]));
  const of = (name: P) => place.get(name) ?? 0;
  const rigidPairs = spec.rigid.flatMap((group) =>
    group.flatMap((a, index) => group.slice(index + 1).map((b) => [of(a), of(b)] as const)),
  );
  return {
    names,
    radius: names.map((name) => spec.points[name].radius),
    lightness: names.map((name) => 1 / spec.points[name].mass),
    pairs: [...spec.links.map(([a, b]) => [of(a), of(b)] as const), ...rigidPairs],
    rigid: spec.rigid.map((group) => group.map(of)),
    hinges: spec.hinges.map(({ from, joint, to, toward }) => ({
      from: of(from),
      joint: of(joint),
      to: of(to),
      across:
        'across' in toward
          ? [of(toward.across[0]), of(toward.across[1])]
          : [of(toward[0]), of(toward[1])],
      up: 'up' in toward ? [of(toward.up[0]), of(toward.up[1])] : undefined,
    })),
    place,
  };
};

const GRAVITY = 9.8;
/** It falls in steps this long, however long the game's are. */
const SUBSTEP = 1 / 120;
const ITERATIONS = 10;
const AIR_DAMPING = 0.998;
/** How much of a point's slide along the floor is left each step it touches it. */
const FLOOR_GRIP = 0.8;
/** A body is soft: once part of a group held together as one touches the floor, how much of the whole group's tumbling each step soaks up, so it does not roll on like a box. */
const SOAK = 0.15;
/** What lies within this of the floor touches it. */
const ON_FLOOR = 0.01;
/** It lies still once nothing has moved faster than this, in metres a second, for this long. */
const REST_SPEED = 0.04;
const REST_SECONDS = 0.6;

/** One coordinate of point `index`, `axis` 0, 1, or 2, as `values` holds it. */
const read = (values: ReadonlyArray<number>, index: number, axis: number) =>
  values[index * 3 + axis] ?? 0;

/** The points of `at`, three numbers each, in `plan`'s order. */
const flattened = <P extends string>(plan: Plan<P>, at: (name: P) => Point) =>
  plan.names.flatMap((name) => {
    const { x, y, z } = at(name);
    return [x, y, z];
  });

/**
 * A body of `plan` starting to fall: its points where `at` puts them, holding the distances they stand at there, each moving at `velocity`, in metres a second, one for all or each its own.
 */
export const start = <P extends string>(
  plan: Plan<P>,
  at: { readonly [Name in P]: Point },
  velocity: Point | { readonly [Name in P]: Point } = { x: 0, y: 0, z: 0 },
): Body => {
  const now = flattened(plan, (name) => at[name]);
  const moving = (name: P): Point => ('x' in velocity ? velocity : velocity[name]);
  const before = flattened(plan, (name) => {
    const { x, y, z } = at[name];
    const v = moving(name);
    return { x: x - v.x * SUBSTEP, y: y - v.y * SUBSTEP, z: z - v.z * SUBSTEP };
  });
  const lengths = plan.pairs.map(([a, b]) =>
    Math.hypot(
      read(now, a, 0) - read(now, b, 0),
      read(now, a, 1) - read(now, b, 1),
      read(now, a, 2) - read(now, b, 2),
    ),
  );
  return { now, before, lengths, quiet: 0, still: false };
};

/** `body` with its point `name` sent moving `velocity` faster, in metres a second, such as by a blow: it moves on from there and wakes if it lay still. */
export const pushed = <P extends string>(
  plan: Plan<P>,
  body: Body,
  name: P,
  velocity: Point,
): Body => {
  const index = plan.place.get(name) ?? 0;
  const before = [...body.before];
  before[index * 3] = read(before, index, 0) - velocity.x * SUBSTEP;
  before[index * 3 + 1] = read(before, index, 1) - velocity.y * SUBSTEP;
  before[index * 3 + 2] = read(before, index, 2) - velocity.z * SUBSTEP;
  return { ...body, before, quiet: 0, still: false };
};

/** Where the point `name` of `body` is. */
export const at = <P extends string>(plan: Plan<P>, body: Body, name: P): Point => {
  const index = plan.place.get(name) ?? 0;
  return { x: read(body.now, index, 0), y: read(body.now, index, 1), z: read(body.now, index, 2) };
};

/** Whether `points` holds a point for every point of `plan`. */
const holdsAll = <P extends string>(
  plan: Plan<P>,
  points: Readonly<Record<string, Point>>,
): points is { readonly [Name in P]: Point } =>
  plan.names.every((name) => points[name] !== undefined);

/** The points of `plan` found among `points` by name, such as where `Shape.standing` stands a figure's bones, to start a body at: none if one of them is missing. */
export const among = <P extends string>(
  plan: Plan<P>,
  points: Readonly<Record<string, Point>>,
): Option.Option<{ readonly [Name in P]: Point }> => {
  const found: Record<string, Point> = {};
  for (const name of plan.names) {
    const point = points[name];
    if (point !== undefined) {
      found[name] = point;
    }
  }
  return holdsAll(plan, found) ? Option.some(found) : Option.none();
};

/** Whether `body` lies still, never to move again unless pushed. */
export const isStill = (body: Body) => body.still;

/** Holds points `a` and `b` of `p` at `length` apart, each giving way as light as it is. */
const hold = (
  p: Array<number>,
  light: ReadonlyArray<number>,
  a: number,
  b: number,
  length: number,
) => {
  const dx = (p[b * 3] ?? 0) - (p[a * 3] ?? 0);
  const dy = (p[b * 3 + 1] ?? 0) - (p[a * 3 + 1] ?? 0);
  const dz = (p[b * 3 + 2] ?? 0) - (p[a * 3 + 2] ?? 0);
  const distance = Math.hypot(dx, dy, dz);
  const wa = light[a] ?? 0;
  const wb = light[b] ?? 0;
  if (distance === 0 || wa + wb === 0) {
    return;
  }
  const off = (distance - length) / distance / (wa + wb);
  p[a * 3] = (p[a * 3] ?? 0) + dx * off * wa;
  p[a * 3 + 1] = (p[a * 3 + 1] ?? 0) + dy * off * wa;
  p[a * 3 + 2] = (p[a * 3 + 2] ?? 0) + dz * off * wa;
  p[b * 3] = (p[b * 3] ?? 0) - dx * off * wb;
  p[b * 3 + 1] = (p[b * 3 + 1] ?? 0) - dy * off * wb;
  p[b * 3 + 2] = (p[b * 3 + 2] ?? 0) - dz * off * wb;
};

/** Keeps the joint of a hinge on the side of the line from its `from` to its `to` that its toward points, pushing it back across, and the line the other way, as light as each is. */
const bend = (
  p: Array<number>,
  light: ReadonlyArray<number>,
  { from, joint, to, across, up }: Plan<string>['hinges'][number],
) => {
  const get = (index: number, axis: number) => p[index * 3 + axis] ?? 0;
  const ux = get(to, 0) - get(from, 0);
  const uy = get(to, 1) - get(from, 1);
  const uz = get(to, 2) - get(from, 2);
  const u = Math.hypot(ux, uy, uz);
  if (u === 0) {
    return;
  }
  const [ax, ay, az] = [ux / u, uy / u, uz / u];
  // The way the joint bends, square to the line: from one point to another, or ahead of a part, across it turned about up it.
  const cx = get(across[1], 0) - get(across[0], 0);
  const cy = get(across[1], 1) - get(across[0], 1);
  const cz = get(across[1], 2) - get(across[0], 2);
  const [ux2, uy2, uz2] =
    up === undefined
      ? [0, 0, 0]
      : [
          get(up[1], 0) - get(up[0], 0),
          get(up[1], 1) - get(up[0], 1),
          get(up[1], 2) - get(up[0], 2),
        ];
  let fx = up === undefined ? cx : cy * uz2 - cz * uy2;
  let fy = up === undefined ? cy : cz * ux2 - cx * uz2;
  let fz = up === undefined ? cz : cx * uy2 - cy * ux2;
  const along = fx * ax + fy * ay + fz * az;
  fx -= ax * along;
  fy -= ay * along;
  fz -= az * along;
  const f = Math.hypot(fx, fy, fz);
  if (f === 0) {
    return;
  }
  fx /= f;
  fy /= f;
  fz /= f;
  const jx = get(joint, 0) - get(from, 0);
  const jy = get(joint, 1) - get(from, 1);
  const jz = get(joint, 2) - get(from, 2);
  const side = jx * fx + jy * fy + jz * fz;
  if (side >= 0) {
    return;
  }
  const wj = light[joint] ?? 0;
  const wf = light[from] ?? 0;
  const wt = light[to] ?? 0;
  const weights = wj + (wf + wt) / 2;
  if (weights === 0) {
    return;
  }
  const move = (index: number, share: number) => {
    p[index * 3] = get(index, 0) + fx * share;
    p[index * 3 + 1] = get(index, 1) + fy * share;
    p[index * 3 + 2] = get(index, 2) + fz * share;
  };
  const push = -side / weights;
  move(joint, push * wj);
  move(from, (-push * wf) / 2);
  move(to, (-push * wt) / 2);
};

/** Keeps point `index` of `p`, `radius` round, above the floor and out of the walls. */
const keepOut = (p: Array<number>, index: number, radius: number, around: Surroundings) => {
  const floor = around.floor + radius;
  if ((p[index * 3 + 1] ?? 0) < floor) {
    p[index * 3 + 1] = floor;
  }
  for (const { min, max } of around.walls) {
    const x = p[index * 3] ?? 0;
    const y = p[index * 3 + 1] ?? 0;
    const z = p[index * 3 + 2] ?? 0;
    const outs = [
      x - (min.x - radius),
      max.x + radius - x,
      y - (min.y - radius),
      max.y + radius - y,
      z - (min.z - radius),
      max.z + radius - z,
    ];
    if (outs.some((out) => out <= 0)) {
      continue;
    }
    // Out by the nearest side.
    const nearest = outs.indexOf(Math.min(...outs));
    const axis = Math.floor(nearest / 2);
    const toward = nearest % 2 === 0 ? -1 : 1;
    p[index * 3 + axis] = (p[index * 3 + axis] ?? 0) + toward * (outs[nearest] ?? 0);
  }
};

/**
 * `body` after `seconds` of falling by `plan` among `around`, in steps of its own however long the game's are: under gravity, each pair of its plan held as far apart as it started, each hinge bending only its way, every point kept above the floor and out of the walls, sliding little along the floor; once nothing of it has moved for a while, it lies still, and stays so.
 */
export const step = <P extends string>(
  plan: Plan<P>,
  body: Body,
  seconds: number,
  around: Surroundings,
): Body => {
  if (body.still) {
    return body;
  }
  const count = Math.max(1, Math.round(seconds / SUBSTEP));
  const dt = seconds / count;
  const now = [...body.now];
  const before = [...body.before];
  const points = plan.names.length;
  let quiet = body.quiet;
  for (let substep = 0; substep < count; substep++) {
    for (let index = 0; index < points; index++) {
      for (let axis = 0; axis < 3; axis++) {
        const at = index * 3 + axis;
        const position = now[at] ?? 0;
        const moved = (position - (before[at] ?? 0)) * AIR_DAMPING;
        before[at] = position;
        now[at] = position + moved - (axis === 1 ? GRAVITY * dt * dt : 0);
      }
    }
    for (let iteration = 0; iteration < ITERATIONS; iteration++) {
      plan.pairs.forEach(([a, b], pair) =>
        hold(now, plan.lightness, a, b, body.lengths[pair] ?? 0),
      );
      for (const hinge of plan.hinges) {
        bend(now, plan.lightness, hinge);
      }
      for (let index = 0; index < points; index++) {
        keepOut(now, index, plan.radius[index] ?? 0, around);
      }
    }
    for (const group of plan.rigid) {
      const down = group.some(
        (index) => (now[index * 3 + 1] ?? 0) <= around.floor + (plan.radius[index] ?? 0) + ON_FLOOR,
      );
      if (down) {
        for (const index of group) {
          for (let axis = 0; axis < 3; axis++) {
            const at = index * 3 + axis;
            before[at] = (now[at] ?? 0) - ((now[at] ?? 0) - (before[at] ?? 0)) * (1 - SOAK);
          }
        }
      }
    }
    let fastest = 0;
    for (let index = 0; index < points; index++) {
      // What touches the floor slides on it little.
      if ((now[index * 3 + 1] ?? 0) <= around.floor + (plan.radius[index] ?? 0) + ON_FLOOR) {
        for (const axis of [0, 2]) {
          const at = index * 3 + axis;
          before[at] = (now[at] ?? 0) - ((now[at] ?? 0) - (before[at] ?? 0)) * FLOOR_GRIP;
        }
      }
      const speed =
        Math.hypot(
          (now[index * 3] ?? 0) - (before[index * 3] ?? 0),
          (now[index * 3 + 1] ?? 0) - (before[index * 3 + 1] ?? 0),
          (now[index * 3 + 2] ?? 0) - (before[index * 3 + 2] ?? 0),
        ) / dt;
      fastest = Math.max(fastest, speed);
    }
    quiet = fastest < REST_SPEED ? quiet + dt : 0;
  }
  const still = quiet >= REST_SECONDS;
  return { now, before: still ? [...now] : before, lengths: body.lengths, quiet, still };
};

/** The flesh about a limb's joints, left and right alike. */
const limb = (thigh: Flesh, calf: Flesh, foot: Flesh, ball: Flesh) => ({ thigh, calf, foot, ball });
const LEG = limb(
  { radius: 0.07, mass: 7 },
  { radius: 0.05, mass: 3.5 },
  { radius: 0.04, mass: 1 },
  { radius: 0.03, mass: 0.3 },
);
const ARM = {
  upper: { radius: 0.045, mass: 2 },
  lower: { radius: 0.04, mass: 1.3 },
  hand: { radius: 0.04, mass: 0.5 },
};

/**
 * How a figure made with MPFB, MakeHuman's Blender add-on, falls, on the `game_engine` rig it makes: a point at each of her bones that bears her weight, by the bone's name, as heavy as a person of sixty kilograms; her trunk, from her hips to her shoulders and neck, held together as one, and each shin with its foot, her ankles holding; her head on her neck, her limbs from joint to joint; and her knees bending only forward, ahead of her hips. `Ragdolling.mpfb` poses her model by it.
 */
export const mpfb = plan({
  points: {
    pelvis: { radius: 0.12, mass: 12 },
    spine_03: { radius: 0.13, mass: 15 },
    neck_01: { radius: 0.05, mass: 2 },
    head: { radius: 0.1, mass: 5 },
    thigh_l: LEG.thigh,
    calf_l: LEG.calf,
    foot_l: LEG.foot,
    ball_l: LEG.ball,
    thigh_r: LEG.thigh,
    calf_r: LEG.calf,
    foot_r: LEG.foot,
    ball_r: LEG.ball,
    upperarm_l: ARM.upper,
    lowerarm_l: ARM.lower,
    hand_l: ARM.hand,
    upperarm_r: ARM.upper,
    lowerarm_r: ARM.lower,
    hand_r: ARM.hand,
  },
  links: [
    ['neck_01', 'head'],
    ['thigh_l', 'calf_l'],
    ['thigh_r', 'calf_r'],
    ['upperarm_l', 'lowerarm_l'],
    ['lowerarm_l', 'hand_l'],
    ['upperarm_r', 'lowerarm_r'],
    ['lowerarm_r', 'hand_r'],
  ],
  rigid: [
    ['pelvis', 'thigh_l', 'thigh_r', 'spine_03', 'upperarm_l', 'upperarm_r', 'neck_01'],
    // Her ankles hold: shin, ankle, and toes as one, so her feet point where her shins do.
    ['calf_l', 'foot_l', 'ball_l'],
    ['calf_r', 'foot_r', 'ball_r'],
  ],
  hinges: [
    {
      from: 'thigh_l',
      joint: 'calf_l',
      to: 'foot_l',
      toward: { across: ['thigh_r', 'thigh_l'], up: ['pelvis', 'spine_03'] },
    },
    {
      from: 'thigh_r',
      joint: 'calf_r',
      to: 'foot_r',
      toward: { across: ['thigh_r', 'thigh_l'], up: ['pelvis', 'spine_03'] },
    },
  ],
});
