import { describe, expect, it } from '@effect/vitest';
import { Story, State } from '@lightocean/core';
import * as Body from '#src/body.ts';
import * as Horde from '#src/game.ts';
import * as Survivor from '#src/survivor.ts';

/** An otherwise empty arena with a survivor of `health` standing at its middle since the start, with nothing in hand, and three kills to its name. */
const arenaWith = (health: number) =>
  State.spawn(State.empty({ seed: 1 }), [
    Body.Position.of({ x: 0, z: 0 }),
    Survivor.Life.of({ _tag: 'Alive', health, since: 0 }),
    Survivor.Tally.of({ kills: 3 }),
    Survivor.Stick.of({ x: 0, z: 0, aim: 0 }),
  ]);
const [arena, survivor] = arenaWith(Survivor.HEALTH);
const standing = Story.given(arena, { survivor });
/** The same survivor, with ten health left. */
const hurt = Story.given(arenaWith(10)[0], { survivor });

describe('a survivor', () => {
  it('walks the way the stick points, at a walking pace', () => {
    Story.story(
      Horde.game,
      standing,
      Story.input('survivor', Survivor.Stick, { x: 1, z: 1, aim: 0 }),
      Story.seconds(1),
      Story.expect('survivor', Body.Position, ({ x, z }) => {
        expect(Math.hypot(x, z)).toBeCloseTo(Survivor.SPEED);
        expect(x).toBeCloseTo(z);
      }),
    );
  });

  it('never walks out of the arena', () => {
    Story.story(
      Horde.game,
      standing,
      Story.input('survivor', Survivor.Stick, { x: 1, z: 0, aim: 0 }),
      Story.seconds(10),
      Story.expect('survivor', Body.Position, ({ x }) => expect(x).toBeCloseTo(Body.ARENA_RADIUS)),
    );
  });

  it('loses health to a bite', () => {
    Story.story(
      Horde.game,
      standing,
      Story.happen(Survivor.Bitten, { survivor, damage: 10 }),
      Story.step(),
      Story.expect('survivor', Survivor.Life, (life) =>
        expect(life).toEqual({ _tag: 'Alive', health: Survivor.HEALTH - 10, since: 0 }),
      ),
    );
  });

  it('dies of the bite that takes the last of its health', () => {
    Story.story(
      Horde.game,
      hurt,
      Story.happen(Survivor.Bitten, { survivor, damage: 10 }),
      Story.step(),
      Story.expect('survivor', Survivor.Life, (life) => expect(life._tag).toBe('Dead')),
    );
  });

  it('stands still once dead, whatever the stick says', () => {
    Story.story(
      Horde.game,
      hurt,
      Story.happen(Survivor.Bitten, { survivor, damage: 10 }),
      Story.input('survivor', Survivor.Stick, { x: 1, z: 0, aim: 0 }),
      Story.seconds(1),
      Story.expectEqual('survivor', Body.Position, { x: 0, z: 0 }),
    );
  });

  it('counts the zombies it kills', () => {
    Story.story(
      Horde.game,
      standing,
      Story.happen(Survivor.Killed, { survivor }),
      Story.step(),
      Story.expect('survivor', Survivor.Tally, ({ kills }) => expect(kills).toBe(4)),
    );
  });

  it('rises again whole, with no kills, once it chooses to after dying', () => {
    Story.story(
      Horde.game,
      hurt,
      Story.happen(Survivor.Bitten, { survivor, damage: 10 }),
      Story.step(),
      Story.act('survivor', Survivor.ChoseRestart, {}),
      Story.step(),
      Story.expectEvent(Survivor.Revived),
      Story.expect('survivor', Survivor.Life, (life) =>
        expect(life).toEqual({ _tag: 'Alive', health: Survivor.HEALTH, since: 2 }),
      ),
      Story.expect('survivor', Survivor.Tally, ({ kills }) => expect(kills).toBe(0)),
    );
  });

  it('cannot choose to rise again while still alive', () => {
    Story.story(
      Horde.game,
      standing,
      Story.act('survivor', Survivor.ChoseRestart, {}),
      Story.step(),
      Story.expectNoEvent(Survivor.Revived),
      Story.expect('survivor', Survivor.Tally, ({ kills }) => expect(kills).toBe(3)),
    );
  });
});
