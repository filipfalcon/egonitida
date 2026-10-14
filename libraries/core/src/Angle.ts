/**
 * Angles about one axis, in radians, turned the short way round: how far one is from another, such as how far a camera must swing to stand behind a player, and one turned toward another at a pace, such as a body turning to face the way it walks. Plain arithmetic, for a system, a rule, or a view alike.
 */

/** The signed turn from `from` to `to`, the short way round: to the left, as an angle grows, if that is shorter, and never more than a half turn either way, however many whole turns lie between them. */
export const turn = (from: number, to: number): number =>
  Math.atan2(Math.sin(to - from), Math.cos(to - from));

/** `angle` turned toward `target` the short way round, by `by` at most, stopping on it: from where it is, so an angle that has made whole turns goes on from them. */
export const toward = (angle: number, target: number, by: number): number => {
  const left = turn(angle, target);
  return Math.abs(left) <= by ? angle + left : angle + Math.sign(left) * by;
};
