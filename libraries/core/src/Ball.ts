import { Schema } from 'effect';
import type * as Ray from '#src/Ray.ts';

/**
 * A ball, as plain data: a rigid sphere flying under gravity, slowed by the air and bent by its spin (the Magnus effect), bouncing off the floor and the walls as it springs back, gripping them as it rolls, and rolling to a stop; and struck by whatever touches it, such as a boot, flying off as fast as that moves and spinning as it brushes across it. It is stepped as a system steps anything, in steps of its own, the same start flying the same way every time, so a replay and a client predicting it fly it as the host did.
 */

const Vector = Schema.Struct({ x: Schema.Finite, y: Schema.Finite, z: Schema.Finite });

/** A ball in flight: where its centre is, how fast it moves, in metres a second, how fast it spins, in radians a second about the axis it spins about, how many seconds it has hardly moved, and whether it lies still. */
export const Ball = Schema.Struct({
  at: Vector,
  velocity: Vector,
  spin: Vector,
  quiet: Schema.Finite,
  still: Schema.Boolean,
});
export type Ball = typeof Ball.Type;

/** A kind of ball: how round and how heavy; how much it springs back from what it hits, from nothing to a whole; how much it grips what it slides on; how much the air slows it and its spin bends it, each an acceleration for every metre a second, and every metre a second times every radian a second; how much rolling slows it, in metres a second each second; and how fast its spin dies away, a share each second. */
export interface Kind {
  readonly radius: number;
  readonly mass: number;
  readonly restitution: number;
  readonly friction: number;
  readonly drag: number;
  readonly lift: number;
  readonly rolling: number;
  readonly spinDamping: number;
}

/** A football of size five: 22 cm across, 430 g; the air's drag and lift worked out at sea level from its drag coefficient, a quarter, and its lift coefficient, a quarter too. */
export const football: Kind = {
  radius: 0.11,
  mass: 0.43,
  restitution: 0.6,
  friction: 0.5,
  drag: 0.0133,
  lift: 0.00146,
  rolling: 0.4,
  spinDamping: 0.5,
};

/** What a ball flies among: the height of the floor, and the walls, boxes square to the axes. */
export interface Surroundings {
  readonly floor: number;
  readonly walls: ReadonlyArray<Ray.Box>;
}

/** What strikes a ball: the point it touches it at, the way from it to the ball's centre, and how fast that point moves, as `Touch.of` finds a touch. */
export interface Strike {
  readonly point: Ray.Point;
  readonly normal: Ray.Point;
  readonly velocity: Ray.Point;
}

/** A ball at rest at `at`. */
export const at = (point: Ray.Point): Ball => ({
  at: point,
  velocity: { x: 0, y: 0, z: 0 },
  spin: { x: 0, y: 0, z: 0 },
  quiet: 0,
  still: false,
});

/** It flies in steps this long, however long the game's are. */
const SUBSTEP = 1 / 120;
/** How hard everything falls, in metres a second each second. */
const GRAVITY = 9.81;
/** Struck slower than this, in metres a second, it settles rather than bouncing. */
const SETTLE = 0.3;
/** It lies still once it has moved slower than this, in metres a second, at its middle and its rim, for this long. */
const STILL_SPEED = 0.01;
const STILL_SECONDS = 0.5;

type Vec = Ray.Point;
const plus = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const less = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const times = (a: Vec, by: number): Vec => ({ x: a.x * by, y: a.y * by, z: a.z * by });
const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec, b: Vec): Vec => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const length = (a: Vec) => Math.sqrt(dot(a, a));

/** How hard a hollow ball of `kind` is to spin: two thirds of its mass at its rim. */
const inertiaOf = (kind: Kind) => (2 / 3) * kind.mass * kind.radius * kind.radius;

/**
 * `ball` gripping a surface it touches along `normal`, from the surface toward its centre, the surface moving at `moving`, pressed onto it as hard as `pressed`, in newton seconds: the slip of its rim over the surface taken away, as far as the grip `grip` of `kind.friction` lets it, each a share; what it takes from its sliding turning into its spin.
 */
const gripped = (
  kind: Kind,
  ball: Ball,
  normal: Vec,
  moving: Vec,
  pressed: number,
  grip: number,
): Ball => {
  const rim = times(normal, -kind.radius);
  // How fast its rim slides over the surface, across the normal.
  const sliding = less(plus(ball.velocity, cross(ball.spin, rim)), moving);
  const slip = less(sliding, times(normal, dot(sliding, normal)));
  const slipping = length(slip);
  if (slipping === 0 || grip <= 0) {
    return ball;
  }
  // The impulse that stops the slip, for a hollow ball, at most what the grip gives.
  const stop = (kind.mass * grip) / (1 + (kind.mass * kind.radius * kind.radius) / inertiaOf(kind));
  const most = kind.friction * grip * pressed;
  const impulse = times(slip, -Math.min(stop, most / slipping));
  return {
    ...ball,
    velocity: plus(ball.velocity, times(impulse, 1 / kind.mass)),
    spin: plus(ball.spin, times(cross(rim, impulse), 1 / inertiaOf(kind))),
  };
};

/** `ball` springing back off a surface along `normal`, from it toward the ball's centre, moving at `moving`, and gripping it as it does; as it is, if it moves away from it already. */
const bounced = (kind: Kind, ball: Ball, normal: Vec, moving: Vec, grip: number): Ball => {
  const toward = dot(less(ball.velocity, moving), normal);
  if (toward >= 0) {
    return ball;
  }
  const settles = -toward < SETTLE;
  const back = settles ? -toward : -(1 + kind.restitution) * toward;
  const sprung = { ...ball, velocity: plus(ball.velocity, times(normal, back)) };
  return gripped(kind, sprung, normal, moving, kind.mass * back, grip);
};

/** `ball` kept out of `wall`, a box: brought to its surface and bounced off it, if it is in it. */
const offWall = (kind: Kind, ball: Ball, wall: Ray.Box): Ball => {
  const nearest = {
    x: Math.min(Math.max(ball.at.x, wall.min.x), wall.max.x),
    y: Math.min(Math.max(ball.at.y, wall.min.y), wall.max.y),
    z: Math.min(Math.max(ball.at.z, wall.min.z), wall.max.z),
  };
  const out = less(ball.at, nearest);
  const distance = length(out);
  if (distance >= kind.radius) {
    return ball;
  }
  // Its centre within the wall: out by the side nearest it.
  const normal =
    distance > 0
      ? times(out, 1 / distance)
      : (() => {
          const sides = [
            [ball.at.x - wall.min.x, { x: -1, y: 0, z: 0 }],
            [wall.max.x - ball.at.x, { x: 1, y: 0, z: 0 }],
            [ball.at.y - wall.min.y, { x: 0, y: -1, z: 0 }],
            [wall.max.y - ball.at.y, { x: 0, y: 1, z: 0 }],
            [ball.at.z - wall.min.z, { x: 0, y: 0, z: -1 }],
            [wall.max.z - ball.at.z, { x: 0, y: 0, z: 1 }],
          ] as const;
          return [...sides].sort((a, b) => a[0] - b[0])[0]?.[1] ?? { x: 0, y: 1, z: 0 };
        })();
  const placed = { ...ball, at: plus(nearest, times(normal, kind.radius)) };
  return bounced(kind, placed, normal, { x: 0, y: 0, z: 0 }, 1);
};

/** `ball` after one step of its own of `seconds`, among `around`. */
const flown = (kind: Kind, ball: Ball, seconds: number, around: Surroundings): Ball => {
  const { velocity, spin } = ball;
  const speed = length(velocity);
  // Gravity, the air's drag against its way, and the lift its spin gives across it.
  const accelerated = plus(
    plus({ x: 0, y: -GRAVITY, z: 0 }, times(velocity, -kind.drag * speed)),
    times(cross(spin, velocity), kind.lift),
  );
  const moving = plus(velocity, times(accelerated, seconds));
  let now: Ball = {
    ...ball,
    velocity: moving,
    at: plus(ball.at, times(moving, seconds)),
    spin: times(spin, Math.max(1 - kind.spinDamping * seconds, 0)),
  };
  const up = { x: 0, y: 1, z: 0 };
  const ground = around.floor + kind.radius;
  if (now.at.y <= ground) {
    now = { ...now, at: { ...now.at, y: ground } };
    const resting = now.velocity.y > -SETTLE;
    now = bounced(kind, now, up, { x: 0, y: 0, z: 0 }, 1);
    if (resting) {
      // On the floor: pressed by its weight, gripping it, and slowed as it rolls.
      now = gripped(kind, now, up, { x: 0, y: 0, z: 0 }, kind.mass * GRAVITY * seconds, 1);
      const along = { x: now.velocity.x, y: 0, z: now.velocity.z };
      const rollingSpeed = length(along);
      const slowed = kind.rolling * seconds;
      const kept = rollingSpeed <= slowed ? 0 : (rollingSpeed - slowed) / rollingSpeed;
      now = {
        ...now,
        velocity: { x: now.velocity.x * kept, y: 0, z: now.velocity.z * kept },
        spin: times(now.spin, kept),
      };
    }
  }
  for (const wall of around.walls) {
    now = offWall(kind, now, wall);
  }
  const hardly = length(now.velocity) < STILL_SPEED && length(now.spin) * kind.radius < STILL_SPEED;
  const quiet = hardly && now.at.y <= ground + 1e-9 ? now.quiet + seconds : 0;
  return quiet >= STILL_SECONDS
    ? { ...now, velocity: { x: 0, y: 0, z: 0 }, spin: { x: 0, y: 0, z: 0 }, quiet, still: true }
    : { ...now, quiet };
};

/**
 * `ball` of `kind` after `seconds` among `around`, in steps of its own however long the game's are: under gravity, slowed by the air, bent by its spin, bouncing off the floor and the walls, gripping the floor as it rolls and slowing to a stop; once it has hardly moved for a while on the floor, it lies still, and stays so until struck.
 */
export const step = (kind: Kind, ball: Ball, seconds: number, around: Surroundings): Ball => {
  if (ball.still) {
    return ball;
  }
  const steps = Math.max(Math.round(seconds / SUBSTEP), 1);
  let now = ball;
  for (let at = 0; at < steps && !now.still; at++) {
    now = flown(kind, now, seconds / steps, around);
  }
  return now;
};

/**
 * `ball` of `kind` struck by `strike`, such as a boot `Touch.of` found touching it: its centre brought to the surface that touches it, springing back off it as fast as that moves, and more as it springs, and gripping it by `grip`, from nothing, a boot that slides across it, to a whole, one that takes it along, so a boot brushing across it spins it. Whatever strikes it moves on as it did, heavier by far. A ball moving away from what touches it already is only brought to its surface; struck, it lies still no longer.
 */
export const struck = (kind: Kind, ball: Ball, strike: Strike, grip: number): Ball => {
  const normal = (() => {
    const long = length(strike.normal);
    return long === 0 ? { x: 0, y: 1, z: 0 } : times(strike.normal, 1 / long);
  })();
  const placed = {
    ...ball,
    at: plus(strike.point, times(normal, kind.radius)),
    quiet: 0,
    still: false,
  };
  return bounced(kind, placed, normal, strike.velocity, grip);
};
