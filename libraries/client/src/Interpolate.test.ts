import { describe, expect, it } from '@effect/vitest';
import { Schema } from 'effect';
import * as Interpolate from '#src/Interpolate.ts';

const between = <Value>(schema: Schema.Codec<Value, unknown>, a: Value, b: Value, t: number) =>
  Interpolate.between(schema, a, b, t);

describe('Interpolate', () => {
  it('moves a number in a straight line', () => {
    expect(between(Schema.Finite, 0, 10, 0.25)).toEqual(2.5);
  });

  it('moves every number of a struct, field by field', () => {
    const Position = Schema.Struct({ x: Schema.Finite, z: Schema.Finite });

    expect(between(Position, { x: 0, z: 10 }, { x: 4, z: 0 }, 0.5)).toEqual({ x: 2, z: 5 });
  });

  it('moves every number of a tuple', () => {
    const Vector = Schema.Tuple([Schema.Finite, Schema.Finite]);

    expect(between(Vector, [0, 0], [2, -2], 0.5)).toEqual([1, -1]);
  });

  it('turns an angle the short way round', () => {
    const Facing = Schema.Finite.annotate({ interpolate: 'angle' });
    // From just short of half a turn one way to just short of it the other: the short way crosses ±π.
    const turned = between(Facing, Math.PI - 0.1, -Math.PI + 0.1, 0.5);

    expect(Math.abs(Math.sin(turned))).toBeLessThan(1e-9);
    expect(Math.cos(turned)).toBeCloseTo(-1);
  });

  it('turns an angle inside a struct the short way round', () => {
    const Pose = Schema.Struct({
      x: Schema.Finite,
      facing: Schema.Finite.annotate({ interpolate: 'angle' }),
    });
    const pose = between(
      Pose,
      { x: 0, facing: Math.PI - 0.1 },
      { x: 2, facing: -Math.PI + 0.1 },
      0.5,
    );

    expect(pose.x).toBe(1);
    expect(Math.cos(pose.facing)).toBeCloseTo(-1);
  });

  it('keeps a value that cannot lie between, such as a whole number, at the earlier one', () => {
    expect(between(Schema.Int, 3, 4, 0.5)).toEqual(3);
    expect(between(Schema.Boolean, false, true, 0.9)).toEqual(false);
    expect(between(Schema.Literals(['Shut', 'Open']), 'Shut', 'Open', 0.9)).toEqual('Shut');
  });

  it('moves a whole number when the value between is whole too', () => {
    expect(between(Schema.Int, 3, 5, 0.5)).toEqual(4);
  });

  it('keeps a number annotated as a step at the earlier value, whatever lies between', () => {
    const Stage = Schema.Int.annotate({ interpolate: 'step' });

    expect(between(Stage, 0, 2, 0.5)).toEqual(0);
    expect(between(Stage, 0, 2, 1)).toEqual(2);
  });

  it('reaches the later value at the end', () => {
    expect(between(Schema.Int, 3, 4, 1)).toEqual(4);
    expect(between(Schema.Finite, 0, 10, 1)).toEqual(10);
  });

  it('is the earlier value at the start', () => {
    expect(between(Schema.Finite, 0, 10, 0)).toEqual(0);
  });
});
