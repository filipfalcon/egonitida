import { describe, expect, it } from '@effect/vitest';
import * as Angle from '#src/Angle.ts';

describe('an angle', () => {
  it('turns to another the short way round, to the left as it grows', () => {
    expect(Angle.turn(0, 1)).toBeCloseTo(1);
    expect(Angle.turn(1, 0)).toBeCloseTo(-1);
    // From just short of a half turn left to just short of a half turn right: a little further right, not almost all the way back.
    expect(Angle.turn(3, -3)).toBeCloseTo(2 * Math.PI - 6);
  });

  it('turns to one a whole turn or more away as to where it lies', () => {
    expect(Angle.turn(0, 2 * Math.PI + 0.5)).toBeCloseTo(0.5);
    expect(Angle.turn(-4 * Math.PI, 0.5)).toBeCloseTo(0.5);
  });

  it('turns toward another by no more than it may, and stops on it', () => {
    expect(Angle.toward(0, 1, 0.25)).toBeCloseTo(0.25);
    expect(Angle.toward(0, -1, 0.25)).toBeCloseTo(-0.25);
    expect(Angle.toward(0, 0.1, 0.25)).toBeCloseTo(0.1);
  });

  it('turns toward another the short way round, from where it is, however many turns it has made', () => {
    expect(Angle.toward(3, -3, 0.1)).toBeCloseTo(3.1);
    // Two whole turns made: it turns on from there, rather than back to within one.
    expect(Angle.toward(4 * Math.PI, 0.5, 1)).toBeCloseTo(4 * Math.PI + 0.5);
  });
});
