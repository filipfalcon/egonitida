import { describe, expect, it } from '@effect/vitest';
import { Strands } from '@egonitida/core';
import * as Body from '#src/body.ts';

describe('her hair', () => {
  const { guides, drawn } = Body.hair;

  it('swings as 230 guides of 8 points, 200 over her scalp and 30 down her ponytail', () => {
    expect([guides.points, guides.scalp, guides.ponytail]).toEqual([8, 200, 30]);
    expect(guides.at).toHaveLength(230 * 8 * 3);
  });

  it('is drawn as 18,984 strands of 16 points, read from her model as it is drawn', () => {
    expect(drawn.points).toBe(16);
    expect(drawn.scalp + drawn.ponytail).toBe(18984);
  });

  it('roots her scalp on her head, and her ponytail on its tie, below it', () => {
    const scalp = Strands.rootOf(guides, 0);
    const ponytail = Strands.rootOf(guides, guides.scalp);
    const head = Body.bones['head']?.at;
    const tie = Body.bones['hair_tie']?.at;

    expect(Math.hypot(scalp.x - (head?.x ?? NaN), scalp.z - (head?.z ?? NaN))).toBeLessThan(0.15);
    expect(
      Math.hypot(
        ponytail.x - (tie?.x ?? NaN),
        ponytail.y - (tie?.y ?? NaN),
        ponytail.z - (tie?.z ?? NaN),
      ),
    ).toBeLessThan(0.05);
  });

  it('is carried by her bones, by their names', () => {
    const carrying = new Set(guides.joints.map((joint) => guides.bones[joint]));

    expect(carrying.has('head')).toBe(true);
    expect(carrying.has('ponytail_01')).toBe(true);
  });

  it('thins from root to tip, and softens', () => {
    const tip = guides.points - 1;

    expect(guides.width[0] ?? 0).toBeGreaterThan(guides.width[tip] ?? Infinity);
    expect(guides.stiffness[0] ?? 0).toBeGreaterThan(guides.stiffness[tip] ?? Infinity);
  });
});
