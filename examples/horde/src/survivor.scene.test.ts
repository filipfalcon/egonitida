import { expect, it } from '@effect/vitest';
import { Haptics, Lighting, Scene } from '@nitida/client';
import { Story, State } from '@nitida/core';
import { Effect } from 'effect';
import * as Body from '#src/body.ts';
import * as Game from '#src/game.ts';
import * as Survivor from '#src/survivor.ts';
import * as SurvivorView from '#src/survivor.view.ts';

/** What a survivor's player was made to feel, for whom, in order. */
type Felt =
  | { readonly _tag: 'Rumble'; readonly entity: State.Entity; readonly rumble: Haptics.Rumble }
  | {
      readonly _tag: 'Triggers';
      readonly entity: State.Entity;
      readonly triggers: Haptics.Triggers;
    };

/** Haptics that keep what they are asked to make felt in `felt`. */
const recording = (felt: Array<Felt>): Haptics.Haptics['Service'] => ({
  rumble: (entity, rumble) =>
    Effect.sync(() => {
      felt.push({ _tag: 'Rumble', entity, rumble });
    }),
  silence: () => Effect.void,
  triggers: (entity, triggers) =>
    Effect.sync(() => {
      felt.push({ _tag: 'Triggers', entity, triggers });
    }),
});

/** Lighting that keeps the colours it is asked to light in `lit`, with whose they are. */
const lighting = (
  lit: Array<{ readonly entity: State.Entity; readonly colour: Lighting.Colour }>,
): Lighting.Lighting['Service'] => ({
  colour: (entity, colour) =>
    Effect.sync(() => {
      lit.push({ entity, colour });
    }),
  players: () => Effect.void,
});

/** A survivor with twenty health, standing; then bitten for ten; then bitten for the last ten: the states of each. */
const bitten = () => {
  const [arena, survivor] = State.spawn(State.empty({ seed: 1 }), [
    Body.Position.of({ x: 0, z: 0 }),
    Survivor.Life.of({ _tag: 'Alive', health: 20, since: 0 }),
    Survivor.Tally.of({ kills: 0 }),
    Survivor.Stick.of({ x: 0, z: 0, aim: 0 }),
  ]);
  const standing = Story.story(Game.game, Story.given(arena, { survivor }));
  const bite = (told: Story.Simulation) =>
    Story.step()(Story.happen(Survivor.Bitten, { survivor, damage: 10 })(told));
  const hurt = bite(standing);
  return { survivor, states: [standing, hurt, bite(hurt)].map(({ state }) => state) };
};

/** Shows each of `states` in turn, through the survivors' views. */
const showAll = (states: ReadonlyArray<State.State>) =>
  Effect.gen(function* () {
    const scene = yield* Scene.make(SurvivorView.views);
    for (const state of states) {
      yield* scene.show(state);
      yield* Effect.yieldNow;
    }
  });

it.effect(
  'makes a survivor feel a bite, the bite that kills harder, and their gun while they live',
  () => {
    const felt: Array<Felt> = [];
    return Effect.gen(function* () {
      const { survivor, states } = bitten();

      yield* showAll(states);

      expect(felt).toEqual([
        { _tag: 'Triggers', entity: survivor, triggers: SurvivorView.GUN },
        { _tag: 'Rumble', entity: survivor, rumble: SurvivorView.BITE },
        { _tag: 'Triggers', entity: survivor, triggers: SurvivorView.GUN },
        { _tag: 'Rumble', entity: survivor, rumble: SurvivorView.DEATH },
        { _tag: 'Triggers', entity: survivor, triggers: Haptics.freeTriggers },
      ]);
    }).pipe(
      Effect.provideService(Haptics.Haptics, recording(felt)),
      Effect.provideService(Lighting.Lighting, lighting([])),
    );
  },
);

it.effect(
  "lights a survivor's player green while whole, redder as they bleed, and dim once dead",
  () => {
    const lit: Array<{ readonly entity: State.Entity; readonly colour: Lighting.Colour }> = [];
    return Effect.gen(function* () {
      const { survivor, states } = bitten();

      yield* showAll(states);

      expect(lit).toEqual([
        { entity: survivor, colour: { red: 0.8, green: 0.2, blue: 0 } },
        { entity: survivor, colour: { red: 0.9, green: 0.1, blue: 0 } },
        { entity: survivor, colour: SurvivorView.DEAD_LIGHT },
      ]);
    }).pipe(
      Effect.provideService(Haptics.Haptics, recording([])),
      Effect.provideService(Lighting.Lighting, lighting(lit)),
    );
  },
);
