import { describe, expect, it } from '@effect/vitest';
import { Story, State } from '@nitida/core';
import * as Walkers from '#src/walkers.ts';

describe('walkers in a shared room', () => {
  it('walk the way their player steers, at their pace, and stand where they stopped', () => {
    const [state, walker] = Walkers.join(Walkers.state);

    Story.story(
      Walkers.game,
      Story.given(state, { walker }),
      Story.demand('walker', Walkers.Steering, { x: 1, z: 0 }),
      Story.seconds(1),
      Story.expect('walker', Walkers.Position, ({ x, z }) => {
        expect(x).toBeCloseTo(Walkers.SPEED);
        expect(z).toBe(0);
      }),
      Story.demand('walker', Walkers.Steering, { x: 0, z: 0 }),
      Story.seconds(1),
      Story.expect('walker', Walkers.Position, ({ x }) => expect(x).toBeCloseTo(Walkers.SPEED)),
    );
  });

  it('stay inside the room, however long they walk into its wall', () => {
    const [state, walker] = Walkers.join(Walkers.state);

    Story.story(
      Walkers.game,
      Story.given(state, { walker }),
      Story.demand('walker', Walkers.Steering, { x: 0, z: -1 }),
      Story.seconds(10),
      Story.expect('walker', Walkers.Position, ({ z }) => expect(z).toBe(-Walkers.HALF_SIZE)),
    );
  });

  it('each have a colour of their own, as they come in', () => {
    const [once, first] = Walkers.join(Walkers.state);
    const [twice, second] = Walkers.join(once);

    const hues = [first, second].map((walker) => State.get(twice, walker, Walkers.Walker));

    expect(hues[0]).not.toEqual(hues[1]);
  });
});
