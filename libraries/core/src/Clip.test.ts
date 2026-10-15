import { describe, expect, it } from '@effect/vitest';
import { Option } from 'effect';
import * as Clip from '#src/Clip.ts';
import type * as Joint from '#src/Joint.ts';
import * as Pose from '#src/Pose.ts';

/** Degrees, as radians. */
const degrees = (angle: number) => (angle * Math.PI) / 180;

const joints: Joint.Joints = {
  calf: {
    kind: 'Hinge',
    motions: { flex: { axis: { x: 1, y: 0, z: 0 }, range: [degrees(-5), degrees(140)], rest: 0 } },
    order: ['flex'],
    depends: [],
    follows: [],
    measures: {},
    flesh: Option.none(),
  },
};

/** A knee bent `angle` degrees, the figure `rise` metres up. */
const kneeAt = (angle: number, rise = 0): Pose.Pose => ({
  ...Pose.rest,
  at: { x: 0, y: rise, z: 0 },
  turns: { calf: { flex: degrees(angle) } },
});

/** A kick: the knee bent 90° at its start, straight a fifth of a second in, and bent 30° at its end, half a second in. */
const kick: Clip.Clip = {
  duration: 0.5,
  times: [0, 0.2, 0.5],
  poses: [kneeAt(90), kneeAt(0, 0.1), kneeAt(30)],
};

describe('Clip.at', () => {
  it('poses a clip as its keys say, between them along their turns', () => {
    const bent = (seconds: number) => Clip.at(joints, kick, seconds).turns['calf']?.['flex'] ?? NaN;

    expect(bent(0)).toBeCloseTo(degrees(90), 12);
    expect(bent(0.1)).toBeCloseTo(degrees(45), 12);
    expect(bent(0.35)).toBeCloseTo(degrees(15), 12);
    expect(Clip.at(joints, kick, 0.1).at.y).toBeCloseTo(0.05, 12);
  });

  it('holds its first pose before it and its last after it', () => {
    expect(Clip.at(joints, kick, -1).turns['calf']?.['flex']).toBeCloseTo(degrees(90), 12);
    expect(Clip.at(joints, kick, 3).turns['calf']?.['flex']).toBeCloseTo(degrees(30), 12);
  });

  it('poses a clip of no keys at rest', () => {
    expect(Clip.at(joints, { duration: 0, times: [], poses: [] }, 0)).toEqual(Pose.rest);
  });
});
