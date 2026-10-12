import { expect, it } from '@effect/vitest';
import { Scene } from '@lightocean/client';
import { Story, State } from '@lightocean/core';
import { Effect, Option } from 'effect';
import * as Body from '#src/body.ts';
import * as Game from '#src/game.ts';
import * as Horde from '#src/horde.ts';
import * as HordeView from '#src/horde.view.ts';
import * as Survivor from '#src/survivor.ts';
import * as SurvivorView from '#src/survivor.view.ts';

/** What is drawn of the arena; what is felt is told in `survivor.scene.test.ts`. */
const views = [SurvivorView.survivors, ...HordeView.views];

/** A survivor aiming along z at a zombie three metres off, who has just shot it down. */
const shotDown = () => {
  const [withSurvivor, survivor] = Survivor.join(State.empty({ seed: 1 }));
  const [state, zombie] = State.spawn(
    withSurvivor,
    Horde.risen({ x: 0, z: 3, health: 1, speed: 1 }),
  );
  return Story.story(
    Game.game,
    Story.given(state, { survivor, zombie }),
    Story.input('survivor', Survivor.Stick, { x: 0, z: 0, aim: Math.PI / 2 }),
    Story.step(),
    Story.act('survivor', Survivor.PulledTrigger, {}),
    Story.step(),
  );
};

it.effect('draws a survivor where they stand, turned the way they aim', () =>
  Effect.gen(function* () {
    const told = shotDown();
    const scene = yield* Scene.make(views);

    yield* scene.show(told.state);

    const drawn = scene.find(SurvivorView.survivors, Story.named(told, 'survivor'));
    const { x, z } = Story.valueOf(told, 'survivor', Body.Position);
    expect(Option.map(drawn, ({ position }) => [position.x, position.z])).toEqual(
      Option.some([x, z]),
    );
    expect(Option.map(drawn, ({ rotation }) => rotation.y)).toEqual(Option.some(-Math.PI / 2));
  }),
);

it.effect('draws a shot the moment it is fired, and not long after', () =>
  Effect.gen(function* () {
    const told = shotDown();
    const later = Story.seconds(1)(told);
    const scene = yield* Scene.make(views);
    const survivor = Story.named(told, 'survivor');

    yield* scene.show(told.state);
    const fired = Option.map(scene.find(HordeView.shots, survivor), ({ visible }) => visible);
    yield* scene.show(later.state);
    const faded = Option.map(scene.find(HordeView.shots, survivor), ({ visible }) => visible);

    expect(fired).toEqual(Option.some(true));
    expect(faded).toEqual(Option.some(false));
  }),
);

it.effect('draws a zombie upright while it shambles, and lying once it falls', () =>
  Effect.gen(function* () {
    const told = shotDown();
    const [shambling, walker] = State.spawn(
      State.empty({ seed: 1 }),
      Horde.risen({ x: 0, z: 3, health: 1, speed: 1 }),
    );
    const upright = yield* Scene.make(views);
    const lying = yield* Scene.make(views);

    yield* upright.show(shambling);
    yield* lying.show(told.state);

    const tilt = (scene: typeof upright, zombie: State.Entity) =>
      Option.map(scene.find(HordeView.zombies, zombie), ({ rotation }) => rotation.x);
    expect(tilt(upright, walker)).toEqual(Option.some(0));
    expect(tilt(lying, Story.named(told, 'zombie'))).toEqual(Option.some(-Math.PI / 2));
  }),
);
