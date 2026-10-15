import type { Pose, Touch } from '@egonitida/core';
import madeBones from '#src/footballer.glb?bones';
import madeJoints from '#src/footballer.glb?joints';
import madeTouches from '#src/footballer.glb?touches';

/**
 * The baller's body, read from her model as the game is built: her bones as made, standing at the origin facing +z, her left toward +x; her joints, by named motions within their anatomical ranges, the way her model writes them; and the parts of her a ball is touched by. Read from the model itself, they never drift from what is drawn.
 */

/** Her bones as made. */
export const bones = madeBones;

/** Her joints. */
export const joints = madeJoints;

/** The parts of her a ball is touched by: her boots' insteps, insides, outsides, soles, heels, and toes, her knees, her thighs, her chest, and her head. */
export const touches = madeTouches;

/** Where the bone `name` stands as made; the origin, if she has none. */
const madeAt = (name: string): Pose.Pose['at'] => bones[name]?.at ?? { x: 0, y: 0, z: 0 };

/** Where each of her ankles stands as she stands still. */
export const standing = { left: madeAt('foot_l'), right: madeAt('foot_r') };

/** How much each part of her grips a ball it brushes across, from nothing to a whole: an inside and an outside curl it, an instep drives it, a sole stops it, a toe pokes it; the rest of her grips little. */
export const gripOf = (part: string): number =>
  part.startsWith('inside') || part.startsWith('outside')
    ? 0.8
    : part.startsWith('instep')
      ? 0.4
      : part.startsWith('sole')
        ? 0.6
        : part.startsWith('toe')
          ? 0.1
          : 0.2;

/** A touch as it springs a ball off her: off the way her surface faces, where the ball meets it on that side, as the flat of a boot does rather than the round of the point standing for it; off the touch's own normal where it meets her from aside or behind. */
export const flatOf = (touched: Touch.Touched): Touch.Touched => {
  const { normal, facing } = touched;
  return normal.x * facing.x + normal.y * facing.y + normal.z * facing.z > 0
    ? { ...touched, normal: facing }
    : touched;
};
