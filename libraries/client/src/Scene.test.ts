import { describe, expect, it } from '@effect/vitest';
import { Component, Domain, Game, Story, System, World } from '@lightocean/core';
import { Context, Effect, Option, Schema } from 'effect';
import * as Three from 'three/webgpu';
import * as Scene from '#src/Scene.ts';
import * as View from '#src/View.ts';

/** A small game: crates that slide along, and that ring when struck. */
const Position = Component.make('Position', Schema.Struct({ x: Schema.Finite }), {
  owner: 'simulation',
  network: 'server',
});
const Crate = Component.make('Crate', Schema.Struct({}), { owner: 'rules', network: 'server' });
const Rung = Component.make('Rung', Schema.Struct({ at: Schema.Int }), {
  owner: 'rules',
  network: 'server',
});
const slide = System.make({
  name: 'slide',
  reads: [Crate],
  writes: [Position],
  emits: [],
  run: (context) => {
    for (const [crate, , at] of context.query(Crate, Position)) {
      context.set(crate, Position, { x: at.x + 1 });
    }
  },
});

const sliding = Game.make({
  stepRate: 10,
  domains: [
    Domain.make({
      name: 'Crates',
      requires: [],
      components: [Crate, Position, Rung],
      actions: [],
      events: [],
      systems: [slide],
      rules: [],
    }),
  ],
});

/** Where the game's sounds go: here, into a list a test reads. */
const Sound = Context.Service<{ readonly play: (name: string) => Effect.Effect<void> }>('Sound');

const crates = View.each([Crate, Position], {
  acquire: () => Effect.succeed(new Three.Mesh()),
  draw: (mesh, held) => {
    mesh.position.x = held(Position).x;
  },
});
const rings = View.on(Rung, () =>
  Effect.gen(function* () {
    const sound = yield* Sound;
    yield* sound.play('ring');
  }),
);

describe('Scene', () => {
  it.effect('shows where a story went, and finds what each view drew for an entity', () =>
    Effect.gen(function* () {
      const told = Story.story(
        sliding,
        Story.spawn('crate', [Crate.of({}), Position.of({ x: 0 })]),
        Story.steps(3),
      );
      const scene = yield* Scene.make([crates]);

      yield* scene.show(told.world);

      const crate = Story.named(told, 'crate');
      expect(Option.map(scene.find(crates, crate), (mesh) => mesh.position.x)).toEqual(
        Option.some(3),
      );
    }),
  );

  it.effect('finds the entity under a point of the screen, as a click would', () =>
    Effect.gen(function* () {
      const told = Story.story(
        sliding,
        Story.spawn('crate', [Crate.of({}), Position.of({ x: 0 })]),
      );
      const boxes = View.each([Crate, Position], {
        acquire: () => Effect.succeed(new Three.Mesh(new Three.BoxGeometry(1, 1, 1))),
        draw: (box, held) => {
          box.position.x = held(Position).x;
        },
      });
      const camera = new Three.PerspectiveCamera(50, 1, 0.1, 100);
      camera.position.set(0, 0, 5);
      const scene = yield* Scene.make([boxes]);

      yield* scene.show(told.world);

      expect(Option.map(scene.pick(camera, { x: 0, y: 0 }), ({ entity }) => entity)).toEqual(
        Option.some(Story.named(told, 'crate')),
      );
    }),
  );

  it.effect('records what views put out through the services a test gives', () => {
    const played: Array<string> = [];
    return Effect.gen(function* () {
      const [quiet, crate] = World.spawn(World.empty({ seed: 1 }), [Crate.of({})]);
      const [rung] = World.spawn(World.despawn(quiet, crate), [Crate.of({}), Rung.of({ at: 1 })]);
      const scene = yield* Scene.make([rings]);

      yield* scene.show(quiet);
      yield* scene.show(rung);
      yield* Effect.yieldNow;

      expect(played).toEqual(['ring']);
    }).pipe(
      Effect.provideService(Sound, {
        play: (name) =>
          Effect.sync(() => {
            played.push(name);
          }),
      }),
    );
  });
});
