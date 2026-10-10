/**
 * The world's own source of randomness. Its state is part of the world, so the same seed and the same steps draw the same numbers everywhere: on the server, in a client's prediction, and in a replay.
 *
 * The generator is Mulberry32: a single 32-bit state, fast, and good enough for gameplay. It is not for anything that must not be guessed.
 */

/** The next number in [0, 1), and the state after drawing it. */
export const next = (state: number): readonly [value: number, state: number] => {
  const advanced = (state + 0x6d2b79f5) >>> 0;
  let mixed = Math.imul(advanced ^ (advanced >>> 15), advanced | 1);
  mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
  return [((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296, advanced];
};
