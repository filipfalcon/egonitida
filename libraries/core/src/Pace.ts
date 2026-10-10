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

/**
 * The first whole millisecond at which a step beyond the `done` taken falls due. The step's moment is worked out from whole steps, so it is exact; waiting until then never wakes a step early or a whole interval late.
 */
export const nextAt = (pace: Pace, done: number): number =>
  pace.origin + Math.ceil(((done + pace.skipped + 1) * 1000) / pace.stepRate);

/**
 * The pace after time was held for `heldMillis`: everything moves on by that long, so the steps that time would have owed are never owed at all, and the world goes on as if no time had passed.
 */
export const resume = (pace: Pace, heldMillis: number): Pace => ({
  ...pace,
  origin: pace.origin + heldMillis,
});
