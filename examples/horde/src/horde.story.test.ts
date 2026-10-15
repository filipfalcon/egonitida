import { describe, expect, it } from '@effect/vitest';
import { Story, State } from '@egonitida/core';
import * as Body from '#src/body.ts';
import * as Horde from '#src/horde.ts';
import * as Game from '#src/game.ts';
import * as Survivor from '#src/survivor.ts';

/** A survivor standing at the middle of the arena since the start, aiming along x. */
const standingAt = (state: State.State, life: Survivor.Life = Survivor.alive(0)) =>
  State.spawn(state, [
    Body.Position.of({ x: 0, z: 0 }),
    Survivor.Life.of(life),
    Survivor.Tally.of({ kills: 0 }),
    Survivor.Stick.of({ x: 0, z: 0, aim: 0 }),
  ]);

/** A zombie at `x`, `z`, as it rises: shambling, at one pace a second, and ready to bite. */
const zombie = (x: number, z: number, health = 1) => Horde.risen({ x, z, health, speed: 1 });

const zombies = (state: State.State) => State.queryIn(state)(Horde.Zombie, Body.Position);

describe('the horde', () => {
  it('rises at the edge of the arena once a survivor has stood a while', () => {
    const [state, survivor] = standingAt(Game.state);
    Story.story(
      Game.game,
      Story.given(state, { survivor }),
      Story.until((now) => zombies(now).length > 0),
      Story.expectState((now) => {
        expect(now.tick).toBeGreaterThanOrEqual(Horde.GRACE_SECONDS * Game.game.stepRate);
        expect(zombies(now).map(([, , { x, z }]) => Math.hypot(x, z))).toEqual([
          expect.closeTo(Body.ARENA_RADIUS, 1),
        ]);
      }),
    );
  });

  it('rises ever faster, the longer a survivor stands', () => {
    const [state, survivor] = standingAt(Game.state);
    const risenAt: Array<number> = [];
    const rising = (count: number) => [
      Story.until((now) => zombies(now).length === count),
      Story.expectState((now) => {
        risenAt.push(now.tick);
      }),
    ];
    Story.story(
      Game.game,
      Story.given(state, { survivor }),
      ...rising(1),
      ...rising(2),
      ...rising(3),
    );
    const [first = 0, second = 0, third = 0] = risenAt;
    expect(third - second).toBeLessThan(second - first);
  });

  it('does not rise while no survivor stands', () => {
    const [state, survivor] = standingAt(Game.state, { _tag: 'Dead', at: 0 });
    Story.story(
      Game.game,
      Story.given(state, { survivor }),
      Story.seconds(10),
      Story.expectState((now) => expect(zombies(now)).toEqual([])),
    );
  });

  it('shambles toward the nearest survivor, and stops short of it', () => {
    const [withSurvivor, survivor] = standingAt(State.empty({ seed: 1 }));
    const [state, walker] = State.spawn(withSurvivor, zombie(5, 0));
    Story.story(
      Game.game,
      Story.given(state, { survivor, walker }),
      Story.seconds(1),
      Story.expect('walker', Body.Position, ({ x, z }) => {
        expect(x).toBeCloseTo(4);
        expect(z).toBeCloseTo(0);
      }),
      Story.seconds(10),
      Story.expect('walker', Body.Position, ({ x }) => expect(x).toBeCloseTo(Horde.STOP)),
    );
  });

  it('bites a survivor within reach, once a second', () => {
    const [withSurvivor, survivor] = standingAt(State.empty({ seed: 1 }));
    const [state] = State.spawn(withSurvivor, zombie(Horde.STOP, 0));
    Story.story(
      Game.game,
      Story.given(state, { survivor }),
      Story.seconds(2),
      Story.expectEvent(Survivor.Bitten, (bites) =>
        expect(bites).toEqual([
          { _tag: 'Bitten', survivor, damage: Horde.BITE_DAMAGE },
          { _tag: 'Bitten', survivor, damage: Horde.BITE_DAMAGE },
        ]),
      ),
    );
  });

  it('falls to a shot along the survivor’s aim, the first zombie in line only, counted to the survivor', () => {
    const [withSurvivor, survivor] = standingAt(State.empty({ seed: 1 }));
    const [withNear, near] = State.spawn(withSurvivor, zombie(3, 0));
    const [state, far] = State.spawn(withNear, zombie(6, 0));
    Story.story(
      Game.game,
      Story.given(state, { survivor, near, far }),
      Story.act('survivor', Survivor.PulledTrigger, {}),
      Story.step(),
      Story.expectEqual('near', Horde.Zombie, { _tag: 'Fallen', at: 1 }),
      Story.expectEqual('far', Horde.Zombie, { _tag: 'Shambling', health: 1 }),
      Story.expectEvent(Survivor.Killed, (killed) =>
        expect(killed).toEqual([{ _tag: 'Killed', survivor }]),
      ),
      Story.expect('survivor', Horde.LastShot, ({ at, to }) => {
        expect(at).toBe(1);
        expect(to.x).toBeCloseTo(3, 1);
      }),
    );
  });

  it('takes as many shots to fall as it has health', () => {
    const [withSurvivor, survivor] = standingAt(State.empty({ seed: 1 }));
    const [state, tough] = State.spawn(withSurvivor, zombie(3, 0, 2));
    Story.story(
      Game.game,
      Story.given(state, { survivor, tough }),
      Story.act('survivor', Survivor.PulledTrigger, {}),
      Story.step(),
      Story.expectEqual('tough', Horde.Zombie, { _tag: 'Shambling', health: 1 }),
      Story.expectNoEvent(Survivor.Killed),
      Story.act('survivor', Survivor.PulledTrigger, {}),
      Story.step(),
      Story.expectEqual('tough', Horde.Zombie, { _tag: 'Fallen', at: 2 }),
    );
  });

  it('is not hit by a shot aimed elsewhere, which flies on as far as a shot goes', () => {
    const [withSurvivor, survivor] = standingAt(State.empty({ seed: 1 }));
    const [state, aside] = State.spawn(withSurvivor, zombie(0, 3));
    Story.story(
      Game.game,
      Story.given(state, { survivor, aside }),
      Story.act('survivor', Survivor.PulledTrigger, {}),
      Story.step(),
      Story.expectEqual('aside', Horde.Zombie, { _tag: 'Shambling', health: 1 }),
      Story.expect('survivor', Horde.LastShot, ({ to }) =>
        expect(to).toEqual({ x: Horde.RANGE, z: 0 }),
      ),
    );
  });

  it('is never shot by a survivor who is dead', () => {
    const [withSurvivor, survivor] = standingAt(State.empty({ seed: 1 }), {
      _tag: 'Dead',
      at: 0,
    });
    const [state, near] = State.spawn(withSurvivor, zombie(3, 0));
    Story.story(
      Game.game,
      Story.given(state, { survivor, near }),
      Story.act('survivor', Survivor.PulledTrigger, {}),
      Story.step(),
      Story.expectEqual('near', Horde.Zombie, { _tag: 'Shambling', health: 1 }),
      Story.expectNone('survivor', Horde.LastShot),
    );
  });

  it('lies where it fell, biting no one, and is gone a while later', () => {
    const [withSurvivor, survivor] = standingAt(State.empty({ seed: 1 }));
    const [state, near] = State.spawn(withSurvivor, zombie(Horde.STOP, 0));
    Story.story(
      Game.game,
      Story.given(state, { survivor, near }),
      Story.act('survivor', Survivor.PulledTrigger, {}),
      Story.step(),
      Story.seconds(Horde.FALLEN_SECONDS - 1),
      Story.expectNoEvent(Survivor.Bitten),
      Story.expectEqual('near', Body.Position, { x: Horde.STOP, z: 0 }),
      Story.seconds(1),
      Story.expectNone('near', Horde.Zombie),
    );
  });

  it('is cleared away once a survivor rises again', () => {
    const [withSurvivor, survivor] = standingAt(State.empty({ seed: 1 }));
    const [state, near] = State.spawn(withSurvivor, zombie(5, 0));
    Story.story(
      Game.game,
      Story.given(state, { survivor, near }),
      Story.happen(Survivor.Revived, { survivor }),
      Story.step(),
      Story.expectNone('near', Horde.Zombie),
      Story.expectNone('near', Body.Position),
    );
  });
});
