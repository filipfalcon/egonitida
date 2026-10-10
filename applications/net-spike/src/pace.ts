/**
 * Keeps a fixed-step simulation at its real rate however irregularly a timer fires. A timer never fires exactly on time, and a stall swallows whole intervals; taking one step per firing would let the world fall behind real time. Instead each firing takes every step real time is owed, up to a maximum, so a slow machine slows briefly rather than falling ever further behind.
 *
 * Steps are counted in whole steps from the moment the pace started, so the count stays exact: 1000 / 30 milliseconds is not.
 */

export interface Pace {
  /** The moment, in milliseconds, the pace started from. */
  readonly origin: number;
  /** Steps per second. */
  readonly stepRate: number;
  /** The most steps taken at once to catch up. */
  readonly maxSteps: number;
  /** Steps given up after stalls longer than the catch-up allows. */
  readonly skipped: number;
}

export const start = (options: {
  readonly now: number;
  readonly stepRate: number;
  readonly maxSteps: number;
}): Pace => ({
  origin: options.now,
  stepRate: options.stepRate,
  maxSteps: options.maxSteps,
  skipped: 0,
});

/** How many steps real time has called for by `now`, less those given up. */
const owed = (pace: Pace, now: number): number =>
  Math.floor(((now - pace.origin) * pace.stepRate) / 1000) - pace.skipped;

/** How many steps to take at `now`, having taken `done` so far. Owing more than the maximum gives up the rest. */
export const due = (
  pace: Pace,
  done: number,
  now: number,
): { readonly steps: number; readonly pace: Pace } => {
  const behind = Math.max(owed(pace, now) - done, 0);
  return behind <= pace.maxSteps
    ? { steps: behind, pace }
    : {
        steps: pace.maxSteps,
        pace: { ...pace, skipped: pace.skipped + behind - pace.maxSteps },
      };
};
