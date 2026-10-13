/**
 * A game's own source of randomness. Its seed is part of the state, and every part of a step draws from a stream of its own, which starts at a counter of the seed, the tick, and what the part is: so the same seed and the same steps draw the same numbers everywhere, on the server, in a client's prediction, and in a replay, and no part's numbers depend on how many another drew before it.
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

/** A 32-bit hash of `text` (FNV-1a), to tell parts apart by name. */
const hash = (text: string): number => {
  let hashed = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hashed = Math.imul(hashed ^ text.charCodeAt(index), 0x01000193);
  }
  return hashed >>> 0;
};

/** Mixes `value`'s bits through one another (Murmur3's finalizer), so counters that differ a little start far apart. */
const mix = (value: number): number => {
  let mixed = value >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x85ebca6b);
  mixed = Math.imul(mixed ^ (mixed >>> 13), 0xc2b2ae35);
  return (mixed ^ (mixed >>> 16)) >>> 0;
};

/** The counter the stream of the part called `part` starts at in the step reaching `tick`, of the game's `seed`. */
export const streamOf = (seed: number, tick: number, part: string): number =>
  mix(seed ^ mix(Math.imul(tick, 0x9e3779b1) ^ hash(part)));
