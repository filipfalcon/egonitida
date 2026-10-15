import type * as Joint from '#src/Joint.ts';
import * as Pose from '#src/Pose.ts';

/**
 * A clip as poses, as plain data: a figure's poses at its keys, read from her model's file as the game is built (`?clips`, through `@egonitida/vite-plugin`), so a step reads a trick authored as a clip, such as a step-over, as surely as a view: the clip gives the pose, and a reach can put the foot right onto the ball. Between its keys, it goes along the joints' turns, as `Pose.between` does.
 */

/** A clip: how many seconds it lasts, and its poses at its keys, the seconds into it of each in order. */
export interface Clip {
  readonly duration: number;
  readonly times: ReadonlyArray<number>;
  readonly poses: ReadonlyArray<Pose.Pose>;
}

/** A figure's clips, by their names. */
export type Clips = Readonly<Record<string, Clip>>;

/** The pose `seconds` into `clip`: between the two keys about it, along their turns; its first pose before it begins and its last after it ends; at rest for a clip of no keys. A clip that cycles is given its seconds within it, as the game counts its cycles. */
export const at = (joints: Joint.Joints, clip: Clip, seconds: number): Pose.Pose => {
  const first = clip.poses[0];
  const last = clip.poses[clip.poses.length - 1];
  const start = clip.times[0];
  const end = clip.times[clip.times.length - 1];
  if (first === undefined || last === undefined || start === undefined || end === undefined) {
    return Pose.rest;
  }
  if (seconds <= start) {
    return first;
  }
  if (seconds >= end) {
    return last;
  }
  for (let key = 1; key < clip.times.length; key++) {
    const to = clip.times[key];
    const from = clip.times[key - 1];
    const after = clip.poses[key];
    const before = clip.poses[key - 1];
    if (to === undefined || from === undefined || after === undefined || before === undefined) {
      continue;
    }
    if (seconds <= to) {
      const span = to - from;
      return span <= 0 ? after : Pose.between(joints, before, after, (seconds - from) / span);
    }
  }
  return last;
};
