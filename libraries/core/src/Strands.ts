import { Option, Schema } from 'effect';
import type * as Joint from '#src/Joint.ts';
import * as Maths from '#src/Maths.ts';
import type * as Pose from '#src/Pose.ts';
import * as Quaternion from '#src/Quaternion.ts';
import type * as Ray from '#src/Ray.ts';
import type * as Shape from '#src/Shape.ts';

/**
 * Hair as strands, as plain data: polylines of points, each strand as many points as every other, root first, read from a model's file as the game is built (`?strands`, through `@egonitida/vite-plugin`). A figure's hair is drawn as many strands and swung as few guides, each drawn strand following the guides nearest its root; the strands over her scalp come first, then those down her ponytail, each kind following guides of its own. Where a point stands as the model was made, how wide it is, how stiff, and which bones carry it, are flat arrays, as a step and a view read them alike.
 *
 * Guides swing as plain data too: each root tied where the bones carrying it place it, the rest trailing as it moves, springing back toward the shape it was groomed in by its stiffness, every link as long as it was made, and kept out of the flesh about her bones it was groomed outside of. It was groomed as it hangs, so only the pull of its weight away from how it hung as groomed moves it: still, it hangs as groomed; bowed, it falls. A ponytail's guides feel no pull of their own, since the chain swinging the bones that carry them hangs them under their weight already. Only a client draws it, so a game keeps it as a local component, stepped by a local system, as a ponytail's chain is; it is stepped in steps of its own, with `Maths`, the same start swinging the same way every time.
 */

/** Strands of hair as the model was made: how many points each strand has; how many lie over the scalp, coming first, and how many down a ponytail, after them; where each point stands, three numbers each, in the model's space; how wide each point is, in metres; how stiff, from nothing to a whole; one random number for each strand, from nothing to a whole; and which bones carry each point, four indices into `bones` each, with their four weights. */
export interface Strands {
  readonly points: number;
  readonly scalp: number;
  readonly ponytail: number;
  readonly at: ReadonlyArray<number>;
  readonly width: ReadonlyArray<number>;
  readonly stiffness: ReadonlyArray<number>;
  readonly random: ReadonlyArray<number>;
  readonly bones: ReadonlyArray<string>;
  readonly joints: ReadonlyArray<number>;
  readonly weights: ReadonlyArray<number>;
}

/** How hair is shaded, as Chiang's model has it, the way Blender's Principled Hair BSDF writes it: how much melanin it holds and how red that is, from nothing to a whole; the colour it is tinted, red, green, and blue; how rough along a strand and about it; how much it shines as a coat; how it bends light; how far its cuticle's scales tilt, in radians; and how much its colour and roughness vary, strand by strand. */
export interface Shading {
  readonly melanin: number;
  readonly melaninRedness: number;
  readonly tint: readonly [red: number, green: number, blue: number];
  readonly roughness: number;
  readonly radialRoughness: number;
  readonly coat: number;
  readonly ior: number;
  readonly offset: number;
  readonly randomColor: number;
  readonly randomRoughness: number;
}

/** A figure's hair as strands: the guides it swings as, every point of them; how many strands are drawn, of how many points, over the scalp and down a ponytail, whose points the drawing reads from the model itself; and how it is shaded. */
export interface Hair {
  readonly guides: Strands;
  readonly drawn: { readonly points: number; readonly scalp: number; readonly ponytail: number };
  readonly shading: Shading;
}

/** How a drawn strand follows its guides: up to three of them, by their index, each by its weight, the weights adding up to a whole. */
export interface Bound {
  readonly guides: ReadonlyArray<number>;
  readonly weights: ReadonlyArray<number>;
}

/** How many guides a drawn strand follows at most. */
const NEAREST = 3;

/** Where strand `strand` of `strands` is rooted: its first point. */
export const rootOf = (strands: Strands, strand: number): Ray.Point => {
  const at = strand * strands.points * 3;
  return {
    x: strands.at[at] ?? 0,
    y: strands.at[at + 1] ?? 0,
    z: strands.at[at + 2] ?? 0,
  };
};

/**
 * How each of the strands `drawn` counts follows `guides`, its roots, three numbers each, in `roots`: each the three guides of its own kind nearest its root, or every guide if none is of its kind, weighted by how near each is, the inverse of its distance; a strand rooted on a guide's root follows it alone. Worked out once, as a drawing is built.
 */
export const bind = (
  guides: Strands,
  drawn: { readonly scalp: number; readonly ponytail: number },
  roots: ReadonlyArray<number>,
): ReadonlyArray<Bound> => {
  const guideRoots = Array.from({ length: guides.scalp + guides.ponytail }, (_, guide) =>
    rootOf(guides, guide),
  );
  const ofKind = (ponytail: boolean) => {
    const kind = guideRoots
      .map((_, guide) => guide)
      .filter((guide) => guide >= guides.scalp === ponytail);
    return kind.length > 0 ? kind : guideRoots.map((_, guide) => guide);
  };
  const scalpGuides = ofKind(false);
  const ponytailGuides = ofKind(true);
  return Array.from({ length: drawn.scalp + drawn.ponytail }, (_, strand): Bound => {
    const x = roots[strand * 3] ?? 0;
    const y = roots[strand * 3 + 1] ?? 0;
    const z = roots[strand * 3 + 2] ?? 0;
    // The nearest guides of its kind, nearest first, picked in one pass over them by how far they are squared.
    const kept: Array<number> = [];
    const squares: Array<number> = [];
    for (const guide of strand < drawn.scalp ? scalpGuides : ponytailGuides) {
      const root = guideRoots[guide] ?? { x: 0, y: 0, z: 0 };
      const across = root.x - x;
      const up = root.y - y;
      const along = root.z - z;
      const square = across * across + up * up + along * along;
      // After every guide kept as near or nearer, if that is among the nearest.
      let at = 0;
      while (at < squares.length && (squares[at] ?? Infinity) <= square) {
        at++;
      }
      if (at < NEAREST) {
        kept.splice(at, 0, guide);
        squares.splice(at, 0, square);
        kept.length = Math.min(kept.length, NEAREST);
        squares.length = Math.min(squares.length, NEAREST);
      }
    }
    const nearest = kept.map((guide, at) => ({ guide, distance: Math.sqrt(squares[at] ?? 0) }));
    const [first] = nearest;
    if (first !== undefined && first.distance === 0) {
      return {
        guides: nearest.map(({ guide }) => guide),
        weights: nearest.map((_, at) => (at === 0 ? 1 : 0)),
      };
    }
    const inverse = nearest.map(({ distance }) => 1 / distance);
    const total = inverse.reduce((sum, weight) => sum + weight, 0);
    return {
      guides: nearest.map(({ guide }) => guide),
      weights: inverse.map((weight) => weight / total),
    };
  });
};

/** A capsule a guide is kept out of, such as the flesh about a bone: from one end of its axis to the other, `radius` round about it, in metres, in the model's space. */
export interface Capsule {
  readonly from: Ray.Point;
  readonly to: Ray.Point;
  readonly radius: number;
}

/** How guides swing: how fast a point of a whole stiffness springs back toward the shape it was groomed in, a share of the way each second, a point of less stiffness as much less; and how much of its swing each loses each step of its own. */
export interface Options {
  readonly stiffness: number;
  readonly damping: number;
}

/** Guides swinging: where each of their points is now and was a moment before, three numbers each, in their order. */
export const Body = Schema.Struct({
  now: Schema.Array(Schema.Finite),
  before: Schema.Array(Schema.Finite),
});
export type Body = typeof Body.Type;

/** They swing in steps this long, however long the game's are. */
const SUBSTEP = 1 / 120;
/** How hard everything falls, in metres a second each second. */
const GRAVITY = 9.81;
/** Straight down, as hard as everything falls. */
const DOWN: Ray.Point = { x: 0, y: -GRAVITY, z: 0 };

/** How a bone carries the points it holds: from where it stood as made to where it is placed, turned as far as it turned since. */
interface Carrier {
  readonly from: Ray.Point;
  readonly to: Ray.Point;
  readonly turn: Quaternion.Quaternion;
}

/** How each bone `strands` names carries what it holds, as made by `made` and placed by `placing`; none for a bone either knows not. */
const carriersOf = (
  strands: Strands,
  made: Shape.Bones,
  placing: Pose.Placer,
): ReadonlyArray<Carrier | undefined> =>
  strands.bones.map((name) => {
    const as = made[name];
    const placed = placing(name);
    return as === undefined || placed === undefined
      ? undefined
      : {
          from: as.at,
          to: placed.at,
          turn: Quaternion.multiply(placed.turn, Quaternion.invert(as.turn)),
        };
  });

/**
 * Where each point of `strands` stands as the bones carrying it are placed by `placing`, three numbers each: each bone carrying it as far as its weight, from where it stood as `made` to where it is placed, as a model's skin is carried. A point no bone it names carries stays where it was made.
 */
export const carried = (
  strands: Strands,
  made: Shape.Bones,
  placing: Pose.Placer,
): ReadonlyArray<number> => {
  const carriers = carriersOf(strands, made, placing);
  const at: Array<number> = [];
  const count = strands.at.length / 3;
  for (let point = 0; point < count; point++) {
    const x = strands.at[point * 3] ?? 0;
    const y = strands.at[point * 3 + 1] ?? 0;
    const z = strands.at[point * 3 + 2] ?? 0;
    let total = 0;
    let sumX = 0;
    let sumY = 0;
    let sumZ = 0;
    for (let influence = 0; influence < 4; influence++) {
      const weight = strands.weights[point * 4 + influence] ?? 0;
      const carrier = carriers[strands.joints[point * 4 + influence] ?? 0];
      if (weight <= 0 || carrier === undefined) {
        continue;
      }
      const turned = Quaternion.rotate(carrier.turn, {
        x: x - carrier.from.x,
        y: y - carrier.from.y,
        z: z - carrier.from.z,
      });
      sumX += weight * (carrier.to.x + turned.x);
      sumY += weight * (carrier.to.y + turned.y);
      sumZ += weight * (carrier.to.z + turned.z);
      total += weight;
    }
    if (total > 0) {
      at.push(sumX / total, sumY / total, sumZ / total);
    } else {
      at.push(x, y, z);
    }
  }
  return at;
};

/** How far the bone carrying most of each strand's root has turned since it was made, one for each strand of `strands`, with those `carriers`; no turn where no bone it names carries it. */
const rootTurns = (
  strands: Strands,
  carriers: ReadonlyArray<Carrier | undefined>,
): ReadonlyArray<Quaternion.Quaternion> =>
  Array.from({ length: strands.scalp + strands.ponytail }, (_, strand) => {
    const root = strand * strands.points;
    let heaviest: Carrier | undefined;
    let most = 0;
    for (let influence = 0; influence < 4; influence++) {
      const weight = strands.weights[root * 4 + influence] ?? 0;
      const carrier = carriers[strands.joints[root * 4 + influence] ?? 0];
      if (weight > most && carrier !== undefined) {
        heaviest = carrier;
        most = weight;
      }
    }
    return heaviest === undefined ? Quaternion.identity : heaviest.turn;
  });

/** How far the bone carrying most of each strand's root has turned since it was `made`, as `placing` places it now, one for each strand of `strands`: the turn its drawn strands keep their places beside it by. */
export const turnsOf = (
  strands: Strands,
  made: Shape.Bones,
  placing: Pose.Placer,
): ReadonlyArray<Quaternion.Quaternion> => rootTurns(strands, carriersOf(strands, made, placing));

/** The pull of each guide's weight away from how it hung as groomed, as `turns` say each root's bone has turned: straight down, less straight down turned as that bone has, nothing as it stands as made. Nothing for a guide down a ponytail: the bones carrying it, which a chain swings, hang it under its weight already. */
const pullsOf = (
  strands: Strands,
  turns: ReadonlyArray<Quaternion.Quaternion>,
): ReadonlyArray<Ray.Point> =>
  turns.map((turn, strand) => {
    if (strand >= strands.scalp) {
      return { x: 0, y: 0, z: 0 };
    }
    const hung = Quaternion.rotate(turn, DOWN);
    return { x: DOWN.x - hung.x, y: DOWN.y - hung.y, z: DOWN.z - hung.z };
  });

/** How long each link of `strands` was made, from the point before it; nothing for a root. */
const lengthsOf = (strands: Strands): ReadonlyArray<number> => {
  const count = strands.at.length / 3;
  const lengths: Array<number> = [];
  for (let point = 0; point < count; point++) {
    lengths.push(
      point % strands.points === 0
        ? 0
        : Maths.hypot(
            (strands.at[point * 3] ?? 0) - (strands.at[point * 3 - 3] ?? 0),
            (strands.at[point * 3 + 1] ?? 0) - (strands.at[point * 3 - 2] ?? 0),
            (strands.at[point * 3 + 2] ?? 0) - (strands.at[point * 3 - 1] ?? 0),
          ),
    );
  }
  return lengths;
};

/** Whether `at` lies inside `capsule`, and the point on its surface nearest, if so. */
const outOf = (capsule: Capsule, x: number, y: number, z: number): Ray.Point | undefined => {
  const axisX = capsule.to.x - capsule.from.x;
  const axisY = capsule.to.y - capsule.from.y;
  const axisZ = capsule.to.z - capsule.from.z;
  const span = axisX * axisX + axisY * axisY + axisZ * axisZ;
  const along =
    span === 0
      ? 0
      : Math.min(
          Math.max(
            ((x - capsule.from.x) * axisX +
              (y - capsule.from.y) * axisY +
              (z - capsule.from.z) * axisZ) /
              span,
            0,
          ),
          1,
        );
  const nearX = capsule.from.x + axisX * along;
  const nearY = capsule.from.y + axisY * along;
  const nearZ = capsule.from.z + axisZ * along;
  const away = Maths.hypot(x - nearX, y - nearY, z - nearZ);
  if (away >= capsule.radius || away === 0) {
    return undefined;
  }
  const out = capsule.radius / away;
  return {
    x: nearX + (x - nearX) * out,
    y: nearY + (y - nearY) * out,
    z: nearZ + (z - nearZ) * out,
  };
};

/** Guides of `strands` starting to swing, as groomed, carried by the bones `placing` places from how they were `made`, still. */
export const start = (strands: Strands, made: Shape.Bones, placing: Pose.Placer): Body => {
  const now = carried(strands, made, placing);
  return { now, before: now };
};

/**
 * The guides `body` of `strands` after `seconds` of swinging, in steps of its own however long the game's are, carried by the bones `placing` places now from how they were `made`, among `capsules`, as `options` say: each root tied where its bones place it; each other point trailing as it moves, losing a little of its swing each step, pulled by its weight only as far as it hangs otherwise than groomed, sprung back toward the shape it was groomed in, as the bones now carry that shape, as far as its stiffness, held as far from the point before it as it was made, and kept out of each capsule it was groomed outside of, which comes first where the two disagree.
 */
export const step = (
  strands: Strands,
  body: Body,
  seconds: number,
  made: Shape.Bones,
  placing: Pose.Placer,
  capsules: ReadonlyArray<Capsule>,
  options: Options,
): Body => {
  const carriers = carriersOf(strands, made, placing);
  const target = carried(strands, made, placing);
  const pulls = pullsOf(strands, rootTurns(strands, carriers));
  const lengths = lengthsOf(strands);
  const steps = Math.max(Math.round(seconds / SUBSTEP), 1);
  const each = seconds / steps;
  const keep = Math.max(1 - options.damping, 0);
  const count = strands.at.length / 3;
  // Which capsules each point was groomed outside of, as the bones carry its groomed place now.
  const kept = Array.from({ length: count }, (_, point) =>
    capsules.filter(
      (capsule) =>
        outOf(
          capsule,
          target[point * 3] ?? 0,
          target[point * 3 + 1] ?? 0,
          target[point * 3 + 2] ?? 0,
        ) === undefined,
    ),
  );
  const now = [...body.now];
  const before = [...body.before];
  for (let at = 0; at < steps; at++) {
    for (let point = 0; point < count; point++) {
      const x = now[point * 3] ?? 0;
      const y = now[point * 3 + 1] ?? 0;
      const z = now[point * 3 + 2] ?? 0;
      const index = point % strands.points;
      if (index === 0) {
        // Tied where its bones place it.
        before[point * 3] = x;
        before[point * 3 + 1] = y;
        before[point * 3 + 2] = z;
        now[point * 3] = target[point * 3] ?? x;
        now[point * 3 + 1] = target[point * 3 + 1] ?? y;
        now[point * 3 + 2] = target[point * 3 + 2] ?? z;
        continue;
      }
      const pull = pulls[Math.floor(point / strands.points)] ?? { x: 0, y: 0, z: 0 };
      let nextX = x + (x - (before[point * 3] ?? x)) * keep + pull.x * each * each;
      let nextY = y + (y - (before[point * 3 + 1] ?? y)) * keep + pull.y * each * each;
      let nextZ = z + (z - (before[point * 3 + 2] ?? z)) * keep + pull.z * each * each;
      before[point * 3] = x;
      before[point * 3 + 1] = y;
      before[point * 3 + 2] = z;
      const aboveX = now[point * 3 - 3] ?? x;
      const aboveY = now[point * 3 - 2] ?? y;
      const aboveZ = now[point * 3 - 1] ?? z;
      // Sprung back toward its groomed shape, hanging from the point before it as the bones carry it.
      const spring = Math.min((strands.stiffness[point] ?? 0) * options.stiffness * each, 1);
      nextX += (aboveX + (target[point * 3] ?? 0) - (target[point * 3 - 3] ?? 0) - nextX) * spring;
      nextY +=
        (aboveY + (target[point * 3 + 1] ?? 0) - (target[point * 3 - 2] ?? 0) - nextY) * spring;
      nextZ +=
        (aboveZ + (target[point * 3 + 2] ?? 0) - (target[point * 3 - 1] ?? 0) - nextZ) * spring;
      for (const capsule of kept[point] ?? []) {
        const surface = outOf(capsule, nextX, nextY, nextZ);
        if (surface !== undefined) {
          nextX = surface.x;
          nextY = surface.y;
          nextZ = surface.z;
        }
      }
      // As far from the point before it as it was made.
      const away = Maths.hypot(nextX - aboveX, nextY - aboveY, nextZ - aboveZ);
      const length = lengths[point] ?? 0;
      const scale = away === 0 ? 0 : length / away;
      let heldX = aboveX + (nextX - aboveX) * scale;
      let heldY = aboveY + (nextY - aboveY) * scale;
      let heldZ = aboveZ + (nextZ - aboveZ) * scale;
      // Out of its capsules again, should holding its length have drawn it back in.
      for (const capsule of kept[point] ?? []) {
        const surface = outOf(capsule, heldX, heldY, heldZ);
        if (surface !== undefined) {
          heldX = surface.x;
          heldY = surface.y;
          heldZ = surface.z;
        }
      }
      now[point * 3] = heldX;
      now[point * 3 + 1] = heldY;
      now[point * 3 + 2] = heldZ;
    }
  }
  return { now, before };
};

/** The flesh about each of the bones `names` that has some, as `joints` say, a capsule from where `placing` places the bone along its own +y, as far as the flesh is long. */
export const capsulesOf = (
  joints: Joint.Joints,
  placing: Pose.Placer,
  names: ReadonlyArray<string>,
): ReadonlyArray<Capsule> =>
  names.flatMap((name) => {
    const flesh = Option.flatMap(Option.fromNullishOr(joints[name]), (joint) => joint.flesh);
    const placed = placing(name);
    if (Option.isNone(flesh) || placed === undefined) {
      return [];
    }
    const along = Quaternion.rotate(placed.turn, { x: 0, y: flesh.value.length, z: 0 });
    return [
      {
        from: placed.at,
        to: { x: placed.at.x + along.x, y: placed.at.y + along.y, z: placed.at.z + along.z },
        radius: flesh.value.radius,
      },
    ];
  });

/** Strands to draw: how many points each has, how many lie over the scalp, coming first, and how many down a ponytail, after them, and where each point stood as made, three numbers each. */
export interface Drawn {
  readonly points: number;
  readonly scalp: number;
  readonly ponytail: number;
  readonly at: ReadonlyArray<number>;
}

/**
 * Where each point of the strands `drawn` is drawn, three numbers each, as `guides` swing to `now`, the bone carrying each guide's root turned as `turns` say since it was made, each drawn strand following its guides as `bound` says: at each guide, as far along it as the point is along its own strand, its place beside that guide as made turned as the guide's root has turned, weighted as the strand follows each. A strand drawn among guides hanging as made is drawn as it was made. A drawing works out the same on the graphics device, every frame.
 */
export const follow = (
  guides: Strands,
  now: ReadonlyArray<number>,
  turns: ReadonlyArray<Quaternion.Quaternion>,
  drawn: Drawn,
  bound: ReadonlyArray<Bound>,
): ReadonlyArray<number> => {
  const at: Array<number> = [];
  const strands = drawn.scalp + drawn.ponytail;
  const lastGuide = guides.points - 1;
  for (let strand = 0; strand < strands; strand++) {
    const follows = bound[strand];
    for (let index = 0; index < drawn.points; index++) {
      const point = strand * drawn.points + index;
      const madeX = drawn.at[point * 3] ?? 0;
      const madeY = drawn.at[point * 3 + 1] ?? 0;
      const madeZ = drawn.at[point * 3 + 2] ?? 0;
      // As far along its guides as it is along its own strand.
      const along = drawn.points > 1 ? (index / (drawn.points - 1)) * lastGuide : 0;
      const below = Math.min(Math.floor(along), Math.max(lastGuide - 1, 0));
      const share = along - below;
      const above = Math.min(below + 1, lastGuide);
      let x = 0;
      let y = 0;
      let z = 0;
      let total = 0;
      (follows?.guides ?? []).forEach((guide, which) => {
        const weight = follows?.weights[which] ?? 0;
        if (weight <= 0) {
          return;
        }
        const from = (guide * guides.points + below) * 3;
        const to = (guide * guides.points + above) * 3;
        const lerp = (values: ReadonlyArray<number>, axis: number) =>
          (values[from + axis] ?? 0) +
          ((values[to + axis] ?? 0) - (values[from + axis] ?? 0)) * share;
        const beside = Quaternion.rotate(turns[guide] ?? Quaternion.identity, {
          x: madeX - lerp(guides.at, 0),
          y: madeY - lerp(guides.at, 1),
          z: madeZ - lerp(guides.at, 2),
        });
        x += weight * (lerp(now, 0) + beside.x);
        y += weight * (lerp(now, 1) + beside.y);
        z += weight * (lerp(now, 2) + beside.z);
        total += weight;
      });
      if (total > 0) {
        at.push(x / total, y / total, z / total);
      } else {
        at.push(madeX, madeY, madeZ);
      }
    }
  }
  return at;
};
