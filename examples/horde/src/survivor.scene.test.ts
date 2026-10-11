import { expect, it } from '@effect/vitest';
import { Haptics, Scene } from '@lightocean/client';
import { Story, World } from '@lightocean/core';
import { Effect } from 'effect';
import * as Body from '#src/body.ts';
import * as Game from '#src/game.ts';
import * as Survivor from '#src/survivor.ts';
import * as SurvivorView from '#src/survivor.view.ts';

/** What a survivor's player was made to feel, for whom, in order. */
type Felt =
  | { readonly _tag: 'Rumble'; readonly entity: World.Entity; readonly rumble: Haptics.Rumble }
  | {
      readonly _tag: 'Triggers';
      readonly entity: World.Entity;
      readonly triggers: Haptics.Triggers;
    };

/** Haptics that keep what they are asked to make felt in `felt`. */
const recording = (felt: Array<Felt>): Haptics.Haptics['Service'] => ({
  rumble: (entity, rumble) =>
    Effect.sync(() => {
      felt.push({ _tag: 'Rumble', entity, rumble });
    }),
  triggers: (entity, triggers) =>
    Effect.sync(() => {
      felt.push({ _tag: 'Triggers', entity, triggers });
    }),
});

it.effect(
  'makes a survivor feel a bite, the bite that kills harder, and their gun while they live',
  () => {
    const felt: Array<Felt> = [];
    return Effect.gen(function* () {
      const [arena, survivor] = World.spawn(World.empty({ seed: 1 }), [
        Body.Position.of({ x: 0, z: 0 }),
        Survivor.Life.of({ _tag: 'Alive', health: 20, since: 0 }),
        Survivor.Tally.of({ kills: 0 }),
        Survivor.Stick.of({ x: 0, z: 0, aim: 0 }),
      ]);
      const standing = Story.story(Game.game, Story.given(arena, { survivor }));
      const bite = (told: Story.Simulation) =>
        Story.step()(Story.happen(Survivor.Bitten, { survivor, damage: 10 })(told));
      const bitten = bite(standing);
      const killed = bite(bitten);
      const scene = yield* Scene.make(SurvivorView.views);

      for (const told of [standing, bitten, killed]) {
        yield* scene.show(told.world);
        yield* Effect.yieldNow;
      }

      expect(felt).toEqual([
        { _tag: 'Triggers', entity: survivor, triggers: SurvivorView.GUN },
        { _tag: 'Rumble', entity: survivor, rumble: SurvivorView.BITE },
        { _tag: 'Triggers', entity: survivor, triggers: SurvivorView.GUN },
        { _tag: 'Rumble', entity: survivor, rumble: SurvivorView.DEATH },
        { _tag: 'Triggers', entity: survivor, triggers: Haptics.freeTriggers },
      ]);
    }).pipe(Effect.provideService(Haptics.Haptics, recording(felt)));
  },
);
