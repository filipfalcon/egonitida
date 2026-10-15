import { describe, expect, it } from '@effect/vitest';
import { Chain, type Component, Game, Pose, Quaternion, State, Story } from '@lightocean/core';
import { Option } from 'effect';
import * as Baller from '#src/baller.ts';
import * as Body from '#src/body.ts';

const [joined, baller] = Baller.join(Baller.state);
const standing = Story.given(joined, { baller, ball: Baller.ball });

/** How far apart two points are. */
const apart = (a: Pose.Pose['at'] | undefined, b: Pose.Pose['at']) =>
  a === undefined ? Infinity : Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Her feet placed as `left` and `right` say, each across, ahead, and lifted. */
const placing = (
  left: Partial<Baller.Placing> = {},
  right: Partial<Baller.Placing> = {},
): Component.ValueOf<typeof Baller.Feet> => ({
  left: { ...Baller.idle.left, ...left },
  right: { ...Baller.idle.right, ...right },
});

describe('a baller', () => {
  it('joins standing, her feet where her model stands them', () => {
    Story.story(
      Baller.game,
      standing,
      Story.step(),
      Story.expect('baller', Baller.Aim, (aim) => {
        expect(apart(aim.left, Body.standing.left)).toBeLessThan(1e-9);
        expect(apart(aim.right, Body.standing.right)).toBeLessThan(1e-9);
      }),
    );
  });

  it('sends a foot where its stick places it, at a foot’s pace, her leg reaching it', () => {
    // Ahead and lifted half way: within her leg's reach.
    const ahead = placing({ y: 1, lift: 0.5 });
    const target = Baller.targetOf(ahead).left;

    Story.story(
      Baller.game,
      standing,
      Story.demand('baller', Baller.Feet, ahead),
      Story.steps(3),
      Story.expect('baller', Baller.Aim, (aim) => {
        // Three sixtieths of a second at five metres a second: a quarter of a metre, not yet there.
        expect(apart(aim.left, Body.standing.left)).toBeCloseTo(0.25, 6);
      }),
      Story.seconds(0.5),
      Story.expect('baller', Baller.Aim, (aim) => {
        expect(apart(aim.left, target)).toBeLessThan(1e-9);
        // Reached from where she stands over her other foot, within her hip's limits: within two centimetres.
        const foot = Pose.place(Body.bones, Body.joints, Baller.poseOf(aim))['foot_l'];
        expect(apart(foot?.at, target)).toBeLessThan(0.02);
      }),
    );
  });

  it('leaves a ball at rest before her where it lies', () => {
    Story.story(
      Baller.game,
      standing,
      Story.seconds(1),
      Story.expect('ball', Baller.Ball, ({ at }) =>
        expect(apart(at, Baller.BALL_START)).toBeLessThan(1e-6),
      ),
    );
  });

  it('sends the ball off a foot swung into it, ahead, as fast as the foot goes and more', () => {
    // Her left foot placed across her, onto the ball before her.
    const across = Body.standing.left.x / Baller.REACH.across;

    Story.story(
      Baller.game,
      standing,
      Story.demand('baller', Baller.Feet, placing({ x: across, y: 1 })),
      Story.seconds(0.3),
      Story.expect('ball', Baller.Ball, ({ at, velocity }) => {
        expect(at.z).toBeGreaterThan(Baller.BALL_START.z + 0.2);
        expect(Math.hypot(velocity.x, velocity.z)).toBeGreaterThan(Baller.FOOT_SPEED * 0.5);
      }),
    );
  });

  it('puts the ball back before her at a press', () => {
    const across = Body.standing.left.x / Baller.REACH.across;

    Story.story(
      Baller.game,
      standing,
      Story.demand('baller', Baller.Feet, placing({ x: across, y: 1 })),
      Story.seconds(0.5),
      // Her foot back where it stands, out of the ball's way.
      Story.demand('baller', Baller.Feet, Baller.idle),
      Story.seconds(0.5),
      Story.act('baller', Baller.ReplacedBall, {}),
      Story.step(),
      Story.expect('ball', Baller.Ball, ({ at, velocity }) => {
        expect(apart(at, Baller.BALL_START)).toBeLessThan(0.01);
        expect(Math.hypot(velocity.x, velocity.y, velocity.z)).toBeLessThan(0.2);
      }),
    );
  });
});

describe('her whole body', () => {
  /** Her pose with her left foot swung `ahead`, from −1 to 1, and lifted half way. */
  const swung = (ahead: number) => Baller.poseOf(Baller.targetOf(placing({ y: ahead, lift: 0.5 })));

  it('swings the arm across from the swinging leg forward, and the one beside it back', () => {
    const forward = swung(1);

    expect(forward.turns['upperarm_r']?.['flex'] ?? 0).toBeGreaterThan(0);
    expect(forward.turns['upperarm_l']?.['flex'] ?? 0).toBeLessThan(0);
  });

  it('turns her trunk against the swinging leg, and leans it toward the foot she stands on', () => {
    const turned = (pose: Pose.Pose, motion: string) =>
      ['spine_01', 'spine_02', 'spine_03', 'spine_04'].reduce(
        (sum, name) => sum + (pose.turns[name]?.[motion] ?? 0),
        0,
      );
    const forward = swung(1);

    // Her left leg ahead, she turns to her right, and leans to her right, over her right foot.
    expect(turned(forward, 'turn')).toBeLessThan(0);
    expect(turned(forward, 'bend')).toBeLessThan(0);
  });

  it('stands over the foot she stands on as the other swings, that foot staying where it stood', () => {
    const pose = swung(1);
    const placed = Pose.place(Body.bones, Body.joints, pose);

    expect(apart(placed['foot_r']?.at, Body.standing.right)).toBeLessThan(0.01);
    // Her pelvis gone toward her right foot.
    expect(pose.at.x).toBeLessThan(0);
  });

  /** The way the surface of her touch point `part` faces, posed as `pose`. */
  const facingOf = (pose: Pose.Pose, part: string) => {
    const point = Body.touches[part];
    const bone =
      point === undefined ? undefined : Pose.placer(Body.bones, Body.joints, pose)(point.bone);
    return point === undefined || bone === undefined
      ? { x: NaN, y: NaN, z: NaN }
      : Quaternion.rotate(bone.turn, point.normal);
  };

  it('keeps a foot swung along the ground pointing ahead and its sole to the ground', () => {
    const along = Baller.poseOf(Baller.targetOf(placing({ y: 1 })));

    // Her toe within ten degrees of straight ahead, her sole within ten of straight down.
    expect(facingOf(along, 'toe_l').z).toBeGreaterThan(Math.cos((10 * Math.PI) / 180));
    expect(-facingOf(along, 'sole_l').y).toBeGreaterThan(Math.cos((10 * Math.PI) / 180));
  });

  it('points a lifted foot’s toes down, its instep facing up, as a juggler holds it', () => {
    const lifted = Baller.poseOf(
      Baller.targetOf(placing({ y: Baller.DROP_AHEAD / Baller.REACH.ahead, lift: 0.5 })),
    );

    // Her instep within ten degrees of straight up.
    expect(facingOf(lifted, 'instep_l').y).toBeGreaterThan(Math.cos((10 * Math.PI) / 180));
  });

  it('turns her shoulders as her arms rise, as her model says they follow', () => {
    const pose = Pose.clamp(Body.bones, Body.joints, swung(1));
    const standing = Pose.clamp(Body.bones, Body.joints, Pose.rest);

    expect(pose.turns['scapula_r']).not.toEqual(standing.turns['scapula_r']);
  });
});

describe('her ponytail', () => {
  /** The ponytail's points after `steps` of her client's own steps from `state`, if she has one yet. */
  const swung = (state: State.State, steps: number) => {
    let now = state;
    for (let tick = 1; tick <= steps; tick++) {
      now = Game.stepLocal(Baller.game, now, { tick });
    }
    return Option.map(State.get(now, baller, Baller.Hair), ({ body }) =>
      Chain.points(Baller.ponytail, body),
    );
  };

  it('hangs from her head where it is tied, below it, its links as long as they were made', () => {
    const made = (name: string) => Body.bones[name]?.at ?? { x: 0, y: 0, z: 0 };
    const tied = made('ponytail_01');

    const points = Option.getOrThrow(swung(joined, 60));

    expect(apart(points['ponytail_01'], tied)).toBeCloseTo(0, 6);
    expect(points['ponytail_05']?.y ?? Infinity).toBeLessThan(tied.y);
    expect(apart(points['ponytail_02'], points['ponytail_01'] ?? tied)).toBeCloseTo(
      apart(made('ponytail_02'), tied),
      6,
    );
  });

  it('swings as she moves', () => {
    const still = Option.getOrThrow(swung(joined, 30));
    const kicking = Story.story(
      Baller.game,
      standing,
      Story.demand('baller', Baller.Feet, placing({ y: 1, lift: 1 })),
      Story.seconds(0.2),
    );

    const moving = Option.getOrThrow(swung(kicking.state, 12));

    expect(
      apart(moving['ponytail_05'], still['ponytail_05'] ?? Body.standing.left),
    ).toBeGreaterThan(0.001);
  });
});

describe('walking and juggling', () => {
  it('walks where she is sent, at a walk’s pace, her feet coming with her', () => {
    Story.story(
      Baller.game,
      standing,
      Story.demand('baller', Baller.Walk, { x: 0, y: 1 }),
      Story.seconds(1),
      Story.expect('baller', Baller.Spot, ({ x, z }) => {
        expect(z).toBeCloseTo(Baller.WALK_SPEED, 1);
        expect(x).toBeCloseTo(0, 6);
      }),
      Story.demand('baller', Baller.Walk, Baller.still),
      Story.seconds(0.5),
      Story.expect('baller', Baller.Aim, (aim) =>
        expect(
          apart(aim.left, Baller.standingAt({ x: 0, z: Baller.WALK_SPEED }).left),
        ).toBeLessThan(0.05),
      ),
    );
  });

  /** Her left foot held where a dropped ball falls: half ahead, as the stick holds it. */
  const ready = placing({ y: Baller.DROP_AHEAD / Baller.REACH.ahead });

  it('drops the ball before her left foot, onto her instep held there, off which it bounces up', () => {
    const rising: Array<number> = [];
    Story.story(
      Baller.game,
      standing,
      Story.demand('baller', Baller.Feet, ready),
      Story.seconds(0.3),
      Story.act('baller', Baller.DroppedBall, {}),
      Story.step(),
      Story.expect('ball', Baller.Ball, ({ at, velocity }) => {
        expect(at.x).toBeCloseTo(Baller.INSTEP.x, 6);
        expect(at.z).toBeCloseTo(Baller.INSTEP.z + Baller.DROP_AHEAD, 6);
        expect(Math.hypot(velocity.x, velocity.z)).toBeLessThan(1e-9);
      }),
      // Falling 0.6 m takes about 0.35 s; off her instep it rises again.
      Story.seconds(0.4),
      Story.expect('ball', Baller.Ball, ({ velocity }) => rising.push(velocity.y)),
    );

    expect(rising[0] ?? 0).toBeGreaterThan(0);
  });

  it('sends a falling ball back up off a foot lifted into it, as a juggle does', () => {
    const heights: Array<number> = [];
    Story.story(
      Baller.game,
      standing,
      Story.demand('baller', Baller.Feet, ready),
      Story.seconds(0.3),
      Story.act('baller', Baller.DroppedBall, {}),
      Story.step(),
      Story.seconds(0.2),
      // As it comes down, her foot lifted into it a little, and back.
      Story.demand(
        'baller',
        Baller.Feet,
        placing({ y: Baller.DROP_AHEAD / Baller.REACH.ahead, lift: 0.3 }),
      ),
      Story.seconds(0.15),
      Story.demand('baller', Baller.Feet, ready),
      Story.seconds(0.2),
      Story.expect('ball', Baller.Ball, ({ at }) => heights.push(at.y)),
    );

    // Up off her foot, above it again.
    expect(heights[0] ?? 0).toBeGreaterThan(Baller.INSTEP.y + 0.2);
  });

  /** The ball's velocity once off her foot, lifted by `lift` as the dropped ball comes down onto it, about a hand above it. */
  const touchedBy = (lift: number) => {
    const velocities: Array<Pose.Pose['at']> = [];
    Story.story(
      Baller.game,
      standing,
      Story.demand('baller', Baller.Feet, ready),
      Story.seconds(0.3),
      Story.act('baller', Baller.DroppedBall, {}),
      Story.step(),
      Story.seconds(0.21),
      Story.demand(
        'baller',
        Baller.Feet,
        placing({ y: Baller.DROP_AHEAD / Baller.REACH.ahead, lift }),
      ),
      Story.seconds(0.19),
      Story.expect('ball', Baller.Ball, ({ velocity }) => velocities.push(velocity)),
    );
    return velocities[0] ?? { x: 0, y: 0, z: 0 };
  };

  it('touches a falling ball up off a foot lifted into it, softly for a trigger pressed a little, harder for one pressed further', () => {
    const soft = touchedBy(0.3);
    const hard = touchedBy(0.6);

    // Both straight up, hardly ahead or aside.
    expect(soft.y).toBeGreaterThan(1);
    expect(hard.y).toBeGreaterThan(soft.y + 1);
    expect(Math.hypot(soft.x, soft.z)).toBeLessThan(0.6);
    expect(Math.hypot(hard.x, hard.z)).toBeLessThan(0.6);
  });

  it('sends a ball falling onto her instep held up, off its middle, back up as the flat of her boot faces, not off its edge', () => {
    const dropped = Story.story(
      Baller.game,
      standing,
      Story.demand(
        'baller',
        Baller.Feet,
        placing({ y: Baller.DROP_AHEAD / Baller.REACH.ahead, lift: 0.25 }),
      ),
      Story.seconds(0.3),
      Story.act('baller', Baller.DroppedBall, {}),
      Story.step(),
    ).state;
    // The ball falling two centimetres ahead of the middle of her instep.
    const falling = Option.getOrThrow(State.get(dropped, Baller.ball, Baller.Ball));
    const draft = State.draft(dropped);
    State.write(draft, Baller.ball, Baller.Ball, {
      ...falling,
      at: { ...falling.at, z: falling.at.z + 0.02 },
    });
    const velocities: Array<Pose.Pose['at']> = [];
    Story.story(
      Baller.game,
      Story.given(State.finish(draft), { baller, ball: Baller.ball }),
      Story.seconds(0.4),
      Story.expect('ball', Baller.Ball, ({ velocity }) => velocities.push(velocity)),
    );
    const [off = { x: 0, y: 0, z: 0 }] = velocities;

    expect(off.y).toBeGreaterThan(0);
    expect(Math.hypot(off.x, off.z)).toBeLessThan(off.y * 0.1);
  });
});
