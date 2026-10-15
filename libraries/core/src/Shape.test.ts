import { describe, expect, it } from '@effect/vitest';
import { Option } from 'effect';
import * as Quaternion from '#src/Quaternion.ts';
import * as Shape from '#src/Shape.ts';

/** A leg standing on the ground as a model was made: a root at the origin, a hip two metres over it, a knee a metre below the hip, and a foot on the ground. */
const leg: Shape.Bones = {
  root: { parent: Option.none(), at: { x: 0, y: 0, z: 0 }, turn: Quaternion.identity },
  hip: { parent: Option.some('root'), at: { x: 0, y: 2, z: 0 }, turn: Quaternion.identity },
  knee: { parent: Option.some('hip'), at: { x: 0, y: 1, z: 0 }, turn: Quaternion.identity },
  foot: { parent: Option.some('knee'), at: { x: 0, y: 0, z: 0 }, turn: Quaternion.identity },
};

/** How far `point` is from `x`, `y`, `z`. */
const off = (point: Shape.Bone['at'] | undefined, x: number, y: number, z: number) =>
  point === undefined ? Infinity : Math.hypot(point.x - x, point.y - y, point.z - z);

describe('Shape.standing', () => {
  it('stands every bone where it was made while the dials are at nothing', () => {
    const shape = Shape.make({ legs: Shape.lengthen(['knee', 'foot'], { by: 0.5 }) });

    const standing = Shape.standing(shape, leg, { legs: 0 });

    expect(off(standing['hip'], 0, 2, 0)).toBeLessThan(1e-9);
    expect(off(standing['foot'], 0, 0, 0)).toBeLessThan(1e-9);
  });

  it('draws a lengthened bone out from its parent, the bones below carried along', () => {
    const shape = Shape.make({ shin: Shape.lengthen(['foot'], { by: 0.5 }) });

    const standing = Shape.standing(shape, leg, { shin: 1 });

    expect(off(standing['knee'], 0, 1, 0)).toBeLessThan(1e-9);
    expect(off(standing['foot'], 0, -0.5, 0)).toBeLessThan(1e-9);
  });

  it('raises a bone as much as the bones beneath it grew, so the foot stays on the ground', () => {
    const shape = Shape.make({
      legs: Shape.lengthen(['knee', 'foot'], { by: 0.5, raises: 'hip' }),
    });

    const longer = Shape.standing(shape, leg, { legs: 1 });
    const shorter = Shape.standing(shape, leg, { legs: -1 });

    expect(off(longer['hip'], 0, 3, 0)).toBeLessThan(1e-9);
    expect(off(longer['knee'], 0, 1.5, 0)).toBeLessThan(1e-9);
    expect(off(longer['foot'], 0, 0, 0)).toBeLessThan(1e-9);
    expect(off(shorter['hip'], 0, 1, 0)).toBeLessThan(1e-9);
    expect(off(shorter['foot'], 0, 0, 0)).toBeLessThan(1e-9);
  });

  it('grows the bones below a grown bone, leaving the bone itself where it stands', () => {
    const shape = Shape.make({ knee: Shape.grow(['knee'], { by: 0.5 }) });

    const standing = Shape.standing(shape, leg, { knee: 1 });

    expect(off(standing['knee'], 0, 1, 0)).toBeLessThan(1e-9);
    expect(off(standing['foot'], 0, -0.5, 0)).toBeLessThan(1e-9);
  });

  it('moves no bone by a morph target, and passes over a bone the figure lacks', () => {
    const shape = Shape.make({
      hips: Shape.morph({ less: 'hips-decr', more: 'hips-incr' }),
      tail: Shape.lengthen(['tail'], { by: 1, raises: 'pelvis' }),
    });

    const standing = Shape.standing(shape, leg, { hips: 1, tail: 1 });

    expect(Object.keys(standing)).toEqual(['root', 'hip', 'knee', 'foot']);
    expect(off(standing['foot'], 0, 0, 0)).toBeLessThan(1e-9);
  });
});

describe('Shape.mpfb', () => {
  const mpfb = Shape.mpfb({ by: 0.1 });

  it('turns each part of an MPFB figure by its two shape keys, as MakeHuman names them', () => {
    expect(mpfb.dials.hips).toEqual(Shape.morph({ less: 'hips-decr', more: 'hips-incr' }));
    expect(mpfb.dials.nose).toEqual(Shape.morph({ less: 'nose-decr', more: 'nose-incr' }));
    expect(Object.keys(mpfb.dials)).toEqual([
      'hips',
      'bust',
      'waist',
      'stomach',
      'buttocks',
      'thighs',
      'calves',
      'arms',
      'cheeks',
      'chin',
      'jaw',
      'nose',
      'legLength',
      'armLength',
      'torsoLength',
    ]);
  });

  it('lengthens her legs, raising her pelvis, and her arms and torso, by the bones of her rig', () => {
    expect(mpfb.dials.legLength).toEqual(
      Shape.lengthen(['calf_l', 'foot_l', 'calf_r', 'foot_r'], { by: 0.1, raises: 'pelvis' }),
    );
    expect(mpfb.dials.armLength).toEqual(
      Shape.lengthen(['lowerarm_l', 'hand_l', 'lowerarm_r', 'hand_r'], { by: 0.1 }),
    );
    expect(mpfb.dials.torsoLength).toEqual(
      Shape.lengthen(['spine_02', 'spine_03', 'neck_01'], { by: 0.1 }),
    );
  });
});
