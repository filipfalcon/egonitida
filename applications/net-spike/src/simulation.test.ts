import { describe, expect, it } from '@effect/vitest';
import { type Input, SPEED, STEP_SECONDS, empty, join, leave, step } from '#src/simulation.ts';

const input = (playerId: string, seq: number, move: readonly [number, number]): Input => ({
  playerId,
  seq,
  move,
});

describe('simulation', () => {
  it('starts with nobody, at tick zero', () => {
    expect(empty).toEqual({ tick: 0, players: [] });
  });

  it('places a joining player at the origin, and removes a leaving one', () => {
    const joined = join(join(empty, 'a'), 'b');

    expect(joined.players).toEqual([
      { id: 'a', position: [0, 0], lastSeq: 0 },
      { id: 'b', position: [0, 0], lastSeq: 0 },
    ]);
    expect(leave(joined, 'a').players.map((player) => player.id)).toEqual(['b']);
  });

  it('ignores a player joining twice', () => {
    const once = join(empty, 'a');

    expect(join(once, 'a')).toBe(once);
  });

  it('advances the tick on every step, inputs or not', () => {
    expect(step(step(empty, []), []).tick).toBe(2);
  });

  it('moves a player by its input, one fixed step at a time', () => {
    const after = step(join(empty, 'a'), [input('a', 1, [1, 0])]);

    expect(after.players[0]?.position).toEqual([SPEED * STEP_SECONDS, 0]);
    expect(after.players[0]?.lastSeq).toBe(1);
  });

  it('keeps a diagonal no faster than a straight move', () => {
    const after = step(join(empty, 'a'), [input('a', 1, [Math.SQRT1_2, Math.SQRT1_2])]);
    const [x = 0, z = 0] = after.players[0]?.position ?? [];

    expect(Math.hypot(x, z)).toBeCloseTo(SPEED * STEP_SECONDS);
  });

  // Inputs arrive repeated, several to a message, so that one lost message loses nothing; only the newest one counts.
  it('applies only the newest input a player sent', () => {
    const after = step(join(empty, 'a'), [input('a', 2, [0, 1]), input('a', 1, [1, 0])]);

    expect(after.players[0]?.position).toEqual([0, SPEED * STEP_SECONDS]);
    expect(after.players[0]?.lastSeq).toBe(2);
  });

  it('ignores an input no newer than one already applied', () => {
    const moved = step(join(empty, 'a'), [input('a', 5, [1, 0])]);
    const after = step(moved, [input('a', 5, [1, 0]), input('a', 4, [-1, 0])]);

    expect(after.players[0]?.position).toEqual(moved.players[0]?.position);
  });

  it('ignores the input of a player who is not in the world', () => {
    const world = join(empty, 'a');

    expect(step(world, [input('ghost', 1, [1, 0])]).players).toEqual(world.players);
  });

  it('ends in the same state from the same inputs', () => {
    const inputs = Array.from({ length: 50 }, (_, index) =>
      input(index % 2 === 0 ? 'a' : 'b', index + 1, [Math.sin(index) / 2, Math.cos(index) / 2]),
    );
    const run = () =>
      inputs.reduce((state, next) => step(state, [next]), join(join(empty, 'a'), 'b'));

    expect(run()).toEqual(run());
  });
});
