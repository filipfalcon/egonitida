import { describe, expect, it } from '@effect/vitest';
import { type Component, Pose, Story } from '@lightocean/core';
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
        const foot = Pose.place(Body.bones, Body.joints, Baller.poseOf(aim))['foot_l'];
        expect(apart(foot?.at, target)).toBeLessThan(0.01);
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
