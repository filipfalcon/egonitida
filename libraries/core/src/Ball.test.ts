import { describe, expect, it } from '@effect/vitest';
import * as Ball from '#src/Ball.ts';

/** Nothing but the floor, at the ground. */
const open: Ball.Surroundings = { floor: 0, walls: [] };

/** `ball` stepped for `seconds`, in steps of a sixtieth of a second, among `around`. */
const after = (ball: Ball.Ball, seconds: number, around: Ball.Surroundings = open) => {
  let now = ball;
  for (let step = 0; step < Math.round(seconds * 60); step++) {
    now = Ball.step(Ball.football, now, 1 / 60, around);
  }
  return now;
};

/** Every height `ball` reaches at the top of a bounce, over `seconds`. */
const peaks = (ball: Ball.Ball, seconds: number) => {
  const reached: Array<number> = [];
  let now = ball;
  let rising = false;
  for (let step = 0; step < Math.round(seconds * 60); step++) {
    const next = Ball.step(Ball.football, now, 1 / 60, open);
    if (rising && next.velocity.y <= 0) {
      reached.push(now.at.y);
    }
    rising = next.velocity.y > 0;
    now = next;
  }
  return reached;
};

const still = { x: 0, y: 0, z: 0 };

describe('a ball', () => {
  it('falls, bounces lower each time, and comes to lie on the floor, as far up as it is round', () => {
    const dropped = Ball.at({ x: 0, y: 2, z: 0 });

    const bounces = peaks(dropped, 4);
    const lying = after(dropped, 8);

    expect(bounces.length).toBeGreaterThan(2);
    expect(bounces[1] ?? 0).toBeLessThan(bounces[0] ?? 0);
    expect(lying.at.y).toBeCloseTo(Ball.football.radius, 6);
    expect(lying.still).toBe(true);
  });

  it('rolls along the floor, slowing, and stops', () => {
    const rolled = {
      ...Ball.at({ x: 0, y: Ball.football.radius, z: 0 }),
      velocity: { x: 0, y: 0, z: 3 },
    };

    const later = after(rolled, 1);
    const stopped = after(rolled, 30);

    expect(later.at.z).toBeGreaterThan(1);
    expect(later.velocity.z).toBeLessThan(3);
    expect(stopped.still).toBe(true);
    // Rolling, it turns as far as it goes: about the line across its way.
    expect(later.spin.x).toBeGreaterThan(0);
  });

  it('curves the way its spin turns it, as a struck ball bends', () => {
    const struck = {
      ...Ball.at({ x: 0, y: 1, z: 0 }),
      velocity: { x: 0, y: 3, z: 25 },
      spin: { x: 0, y: 60, z: 0 },
    };
    const plain = { ...struck, spin: still };

    expect(after(struck, 0.8).at.x).toBeGreaterThan(after(plain, 0.8).at.x + 0.3);
  });

  it('flies off a foot as fast as the foot moves, and more for how it springs back', () => {
    const resting = Ball.at({ x: 0, y: 0.11, z: 0.3 });

    const kicked = Ball.struck(
      Ball.football,
      resting,
      {
        point: { x: 0, y: 0.11, z: 0.19 },
        normal: { x: 0, y: 0, z: 1 },
        velocity: { x: 0, y: 0, z: 20 },
      },
      0.5,
    );

    expect(kicked.velocity.z).toBeCloseTo(20 * (1 + Ball.football.restitution), 6);
    expect(kicked.still).toBe(false);
  });

  it('spins off a foot that brushes across it, the more for the boot’s grip', () => {
    const resting = Ball.at({ x: 0, y: 0.11, z: 0.3 });
    const brushed = (grip: number) =>
      Ball.struck(
        Ball.football,
        resting,
        {
          point: { x: 0, y: 0.11, z: 0.19 },
          normal: { x: 0, y: 0, z: 1 },
          velocity: { x: 6, y: 0, z: 10 },
        },
        grip,
      );

    expect(brushed(1).spin.y).toBeLessThan(0);
    expect(Math.abs(brushed(1).spin.y)).toBeGreaterThan(Math.abs(brushed(0.2).spin.y));
    expect(brushed(0).spin.y).toBeCloseTo(0, 12);
  });

  it('bounces off a wall in its way, staying out of it', () => {
    const thrown = { ...Ball.at({ x: 0, y: 1, z: 0 }), velocity: { x: 8, y: 0, z: 0 } };
    const wall = { min: { x: 1, y: 0, z: -5 }, max: { x: 2, y: 3, z: 5 } };

    const back = after(thrown, 0.5, { floor: 0, walls: [wall] });

    expect(back.at.x).toBeLessThan(1 - Ball.football.radius + 1e-9);
    expect(back.velocity.x).toBeLessThan(0);
  });

  it('flies the same each time from the same start, as a replay must', () => {
    const kicked = () => ({
      ...Ball.at({ x: 0, y: 0.11, z: 0 }),
      velocity: { x: 1, y: 6, z: 20 },
      spin: { x: -10, y: 30, z: 0 },
    });

    expect(after(kicked(), 3)).toEqual(after(kicked(), 3));
  });
});
