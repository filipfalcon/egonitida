/**
 * A game's own source of randomness. Its counter is part of the state, so the same seed and the same steps draw the same numbers everywhere: on the server, in a client's prediction, and in a replay.
 *
 * The generator is Mulberry32: a single 32-bit counter, to which each draw adds a constant and which it mixes into the number drawn. It is fast and good enough for gameplay, and not for anything that must not be guessed.
 */

/** The next number in [0, 1), and the counter after drawing it. */
export const next = (counter: number): readonly [value: number, counter: number] => {
  const nextCounter = (counter + 0x6d2b79f5) >>> 0;
  let mixed = Math.imul(nextCounter ^ (nextCounter >>> 15), nextCounter | 1);
  mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
  return [((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296, nextCounter];
};
