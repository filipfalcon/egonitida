import { describe, expect, it } from '@effect/vitest';
import { Component, World } from '@lightocean/core';
import { Effect, Exit, Option, Schema, Scope } from 'effect';
import * as Three from 'three/webgpu';
import * as Drawing from '#src/Drawing.ts';
import * as Timeline from '#src/Timeline.ts';
import * as View from '#src/View.ts';

const Position = Component.make('Position', Schema.Struct({ x: Schema.Finite }), {
  owner: 'simulation',
  network: 'server',
});
const Crate = Component.make('Crate', Schema.Struct({}), { owner: 'rules', network: 'server' });
/** A moment kept as state: when something was last struck. */
const Struck = Component.make('Struck', Schema.Struct({ at: Schema.Int }), {
  owner: 'rules',
  network: 'server',
});

/** Draws `worlds` one frame each, through `views`, and gives what each frame left in the root. */
const play = <R>(views: View.Views<R>, worlds: ReadonlyArray<World.World>) =>
  Effect.gen(function* () {
    const shown: Array<ReadonlyArray<Three.Object3D>> = [];
    const state = { previous: Option.none<Timeline.View>() };
    for (const world of worlds) {
      const view = Timeline.still(world);
      yield* views.frame(Drawing.frameOf(view, state.previous));
      state.previous = Option.some(view);
      shown.push([...views.root.children]);
    }
    return shown;
  });

const crateAt = (x: number) => [Crate.of({}), Position.of({ x })];

describe('View.each', () => {
  it.effect(
    'builds an object for each entity holding what it asks for, and draws it every frame',
    () =>
      Effect.gen(function* () {
        const crates = View.each([Crate, Position], {
          acquire: () => Effect.succeed(new Three.Group()),
          draw: (group, held) => {
            group.position.x = held(Position).x;
          },
        });
        const views = yield* View.make([crates]);
        const [first] = World.spawn(World.empty({ seed: 1 }), crateAt(1));
        const [withLoose] = World.spawn(first, [Position.of({ x: 9 })]);
        const moved = World.despawn(World.spawn(World.empty({ seed: 1 }), crateAt(3))[0], 1);

        const [once] = yield* play(views, [withLoose]);
        const drawnFirst = once?.map(({ position }) => position.x);
        const [twice] = yield* play(views, [moved]);

        expect(drawnFirst).toEqual([1]);
        expect(twice?.map(({ position }) => position.x)).toEqual([3]);
        expect(twice?.[0]).toBe(once?.[0]);
      }),
  );

  it.effect(
    'lets go of what it built once the entity leaves, or stops holding what it asks for',
    () =>
      Effect.gen(function* () {
        const released: Array<number> = [];
        const crates = View.each([Crate, Position], {
          acquire: (held) =>
            Effect.acquireRelease(Effect.succeed(new Three.Group()), () =>
              Effect.sync(() => {
                released.push(held(Position).x);
              }),
            ),
          draw: () => {},
        });
        const views = yield* View.make([crates]);
        const [two] = World.spawn(World.spawn(World.empty({ seed: 1 }), crateAt(1))[0], crateAt(2));
        const [uncrated] = World.spawn(World.empty({ seed: 1 }), [Position.of({ x: 1 })]);

        const [both, none] = yield* play(views, [two, uncrated]);

        expect(both).toHaveLength(2);
        expect(none).toEqual([]);
        expect(released.toSorted((a, b) => a - b)).toEqual([1, 2]);
      }),
  );

  it.effect('builds anew for an entity that comes back to holding what it asks for', () =>
    Effect.gen(function* () {
      const crates = View.each([Crate, Position], {
        acquire: () => Effect.succeed(new Three.Group()),
        draw: () => {},
      });
      const views = yield* View.make([crates]);
      const [crated] = World.spawn(World.empty({ seed: 1 }), crateAt(1));
      const [uncrated] = World.spawn(World.empty({ seed: 1 }), [Position.of({ x: 1 })]);

      const [before, , after] = yield* play(views, [crated, uncrated, crated]);

      expect(after?.[0]).not.toBe(before?.[0]);
    }),
  );
});

describe('View.on', () => {
  it.effect('reacts when an entity gains a component, and when it holds another value of it', () =>
    Effect.gen(function* () {
      const heard: Array<number> = [];
      const struck = View.on(Struck, (value) =>
        Effect.sync(() => {
          heard.push(value.at);
        }),
      );
      const views = yield* View.make([struck]);
      const at = (tick: number) =>
        World.spawn(World.empty({ seed: 1 }), [Crate.of({}), Struck.of({ at: tick })])[0];
      const [bare] = World.spawn(World.empty({ seed: 1 }), [Crate.of({})]);

      yield* play(views, [bare, at(3), at(3), at(5)]);
      yield* Effect.yieldNow;

      expect(heard).toEqual([3, 5]);
    }),
  );
});

describe('View.during', () => {
  it.effect('holds what it acquires while a condition holds, and lets it go once it does not', () =>
    Effect.gen(function* () {
      const events: Array<string> = [];
      const crowded = View.during(
        (frame) => frame.query(Crate).length >= 2,
        Effect.acquireRelease(
          Effect.sync(() => {
            events.push('acquired');
          }),
          () =>
            Effect.sync(() => {
              events.push('released');
            }),
        ),
      );
      const views = yield* View.make([crowded]);
      const [one] = World.spawn(World.empty({ seed: 1 }), crateAt(1));
      const [two] = World.spawn(one, crateAt(2));

      yield* play(views, [one, two, two, one]);

      expect(events).toEqual(['acquired', 'released']);
    }),
  );
});

describe('View.make', () => {
  it.effect('lets go of everything its views hold when its scope closes', () =>
    Effect.gen(function* () {
      const released: Array<string> = [];
      const crates = View.each([Crate], {
        acquire: () =>
          Effect.acquireRelease(Effect.succeed(new Three.Group()), () =>
            Effect.sync(() => {
              released.push('crate');
            }),
          ),
        draw: () => {},
      });
      const scope = yield* Scope.make();
      const views = yield* View.make([crates]).pipe(Scope.provide(scope));
      yield* play(views, [World.spawn(World.empty({ seed: 1 }), [Crate.of({})])[0]]);

      yield* Scope.close(scope, Exit.void);

      expect(released).toEqual(['crate']);
      expect(views.root.children).toEqual([]);
    }),
  );
});

describe('picking', () => {
  /** A crate as a unit box, standing where its position puts it, and a streak drawn across everything. */
  const boxes = View.each([Crate, Position], {
    acquire: () =>
      Effect.succeed(
        new Three.Mesh(new Three.BoxGeometry(1, 1, 1), new Three.MeshBasicNodeMaterial()),
      ),
    draw: (box, held) => {
      box.position.x = held(Position).x;
    },
  });
  const streaks = View.each([Struck], {
    acquire: () => {
      const geometry = new Three.BufferGeometry().setFromPoints([
        new Three.Vector3(-10, 0, 2),
        new Three.Vector3(10, 0, 2),
      ]);
      return Effect.succeed(new Three.Line(geometry, new Three.LineBasicNodeMaterial()));
    },
    draw: () => {},
  });
  /** A camera five units back, looking at the middle. */
  const camera = new Three.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);

  const drawn = Effect.gen(function* () {
    const views = yield* View.make([boxes, streaks]);
    const [one, left] = World.spawn(World.empty({ seed: 1 }), crateAt(0));
    const [two, right] = World.spawn(one, crateAt(2));
    const [world] = World.spawn(two, [Struck.of({ at: 1 })]);
    yield* play(views, [world]);
    return { views, left, right };
  });

  it.effect(
    'finds the entity whose object is nearest under a point, and the view that drew it',
    () =>
      Effect.gen(function* () {
        const { views, left, right } = yield* drawn;

        const middle = views.pick(camera, { x: 0, y: 0 });
        const toTheRight = views.pick(camera, new Three.Vector3(2, 0, 0).project(camera));

        expect(Option.map(middle, ({ entity, view }) => [entity, view === boxes])).toEqual(
          Option.some([left, true]),
        );
        expect(Option.map(toTheRight, ({ entity }) => entity)).toEqual(Option.some(right));
      }),
  );

  it.effect('finds nothing where nothing is drawn, and never a line, which no pointer hits', () =>
    Effect.gen(function* () {
      const { views } = yield* drawn;

      expect(views.pick(camera, { x: 0.9, y: 0.9 })).toEqual(Option.none());
      expect(views.pick(camera, { x: -0.9, y: 0 })).toEqual(Option.none());
    }),
  );
});

describe('objects of an entity', () => {
  it.effect('are what every view built for it', () =>
    Effect.gen(function* () {
      const boxes = View.each([Crate], {
        acquire: () => Effect.succeed(new Three.Group()),
        draw: () => {},
      });
      const marks = View.each([Position], {
        acquire: () => Effect.succeed(new Three.Group()),
        draw: () => {},
      });
      const views = yield* View.make([boxes, marks]);
      const [world, crate] = World.spawn(World.empty({ seed: 1 }), crateAt(1));
      const [, loose] = World.spawn(world, [Position.of({ x: 2 })]);

      yield* play(views, [World.spawn(world, [Position.of({ x: 2 })])[0]]);

      expect(views.objectsOf(crate)).toEqual([
        Option.getOrThrow(views.find(boxes, crate)),
        Option.getOrThrow(views.find(marks, crate)),
      ]);
      expect(views.objectsOf(loose)).toHaveLength(1);
      expect(views.objectsOf(99)).toEqual([]);
    }),
  );
});

describe('View.rig', () => {
  /** A player's body, drawn as a group where it stands. */
  const bodies = View.each([Position], {
    acquire: () => Effect.succeed(new Three.Group()),
    draw: (group, held) => {
      group.position.x = held(Position).x;
    },
  });
  /** Eyes 1.6 metres up whatever the player is drawn as. */
  const eyes = View.rig([Position], (camera, _held, _frame, drawn) => {
    camera.position.y = 1.6;
    Option.map(drawn(bodies, player), (body) => {
      camera.position.x = body.position.x;
    });
  });
  const [world, player] = World.spawn(World.empty({ seed: 1 }), [Position.of({ x: 4 })]);
  const [withOther, other] = World.spawn(world, [Position.of({ x: 9 })]);

  it.effect('draws the camera for the player after every view has drawn, from what they drew', () =>
    Effect.gen(function* () {
      const camera = new Three.PerspectiveCamera();
      const views = yield* View.make([eyes, bodies], Option.some({ camera, player }));

      yield* play(views, [world]);

      expect([camera.position.x, camera.position.y]).toEqual([4, 1.6]);
    }),
  );

  it.effect('draws nothing for anyone but the player, nor while the player holds too little', () =>
    Effect.gen(function* () {
      const drawnFor: Array<number> = [];
      const following = View.rig([Position, Crate], (_camera, held) => {
        drawnFor.push(held(Position).x);
      });
      const camera = new Three.PerspectiveCamera();
      const views = yield* View.make([following], Option.some({ camera, player: other }));
      const [crated] = World.spawn(withOther, crateAt(7));

      yield* play(views, [withOther, crated]);

      expect(drawnFor).toEqual([]);
    }),
  );

  it.effect('draws rigs one after another, in the order they are given', () =>
    Effect.gen(function* () {
      const shaken = View.rig([Position], (camera) => {
        camera.position.y += 0.1;
      });
      const camera = new Three.PerspectiveCamera();
      const views = yield* View.make([shaken, bodies, eyes], Option.some({ camera, player }));

      yield* play(views, [world]);

      expect(camera.position.y).toBeCloseTo(1.6);
    }),
  );

  it.effect('leaves rigs undrawn where the views are given no camera and no player', () =>
    Effect.gen(function* () {
      const views = yield* View.make([bodies, eyes]);

      const [drawn] = yield* play(views, [world]);

      expect(drawn).toHaveLength(1);
    }),
  );
});
