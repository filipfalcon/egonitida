import { describe, expect, it } from '@effect/vitest';
import { Component, State } from '@lightocean/core';
import { Context, Effect, Exit, Option, Schema, Scope } from 'effect';
import * as Three from 'three/webgpu';
import * as Drawing from '#src/Drawing.ts';
import * as Timeline from '#src/Timeline.ts';
import * as View from '#src/View.ts';

const Position = Component.make('Position', Schema.Struct({ x: Schema.Finite }), {
  owner: 'simulation',
  network: 'server',
});
const Crate = Component.make('Crate', Schema.Struct({}), { owner: 'rules', network: 'server' });
/** A moment kept as a component: when something was last struck. */
const Struck = Component.make('Struck', Schema.Struct({ at: Schema.Int }), {
  owner: 'rules',
  network: 'server',
});

/** Draws `states` one frame each, through `views`, and gives what each frame left in the root. */
const play = <R>(views: View.Views<R>, states: ReadonlyArray<State.State>) =>
  Effect.gen(function* () {
    const shown: Array<ReadonlyArray<Three.Object3D>> = [];
    const seen = { previous: Option.none<Timeline.View>() };
    for (const state of states) {
      const view = Timeline.still(state);
      yield* views.frame(Drawing.frameOf(view, seen.previous));
      seen.previous = Option.some(view);
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
        const [first] = State.spawn(State.empty({ seed: 1 }), crateAt(1));
        const [withLoose] = State.spawn(first, [Position.of({ x: 9 })]);
        const moved = State.despawn(State.spawn(State.empty({ seed: 1 }), crateAt(3))[0], 1);

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
        const [two] = State.spawn(State.spawn(State.empty({ seed: 1 }), crateAt(1))[0], crateAt(2));
        const [uncrated] = State.spawn(State.empty({ seed: 1 }), [Position.of({ x: 1 })]);

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
      const [crated] = State.spawn(State.empty({ seed: 1 }), crateAt(1));
      const [uncrated] = State.spawn(State.empty({ seed: 1 }), [Position.of({ x: 1 })]);

      const [before, , after] = yield* play(views, [crated, uncrated, crated]);

      expect(after?.[0]).not.toBe(before?.[0]);
    }),
  );
});

describe('what View.each is given', () => {
  it.effect('is, to acquire, what the entity holds, the frame, and the entity, in that order', () =>
    Effect.gen(function* () {
      const given: Array<string> = [];
      const crates = View.each([Crate, Position], {
        acquire: (held, frame, entity) =>
          Effect.sync(() => {
            given.push(`${held(Position).x} ${frame.tick} ${entity}`);
            return new Three.Group();
          }),
        draw: (_group, held, frame) => {
          given.push(`drawn ${held(Position).x} ${frame.tick}`);
        },
      });
      const views = yield* View.make([crates]);
      const [state, crate] = State.spawn(State.empty({ seed: 1 }), crateAt(4));

      yield* play(views, [state]);

      expect(given).toEqual([`4 0 ${crate}`, 'drawn 4 0']);
    }),
  );
});

describe('whose entity View.each draws', () => {
  it.effect(
    'tells draw whether the entity is the player the views are drawn for, whose eyes the camera looks through, so a body may leave its own head out',
    () =>
      Effect.gen(function* () {
        const told: Array<string> = [];
        const crates = View.each([Crate, Position], {
          acquire: () => Effect.succeed(new Three.Group()),
          draw: (_group, held, _frame, _input, viewer) => {
            told.push(`${held(Position).x} ${viewer}`);
          },
        });
        const [one, mine] = State.spawn(State.empty({ seed: 1 }), crateAt(1));
        const [both] = State.spawn(one, crateAt(2));
        const views = yield* View.make(
          [crates],
          Option.some({ camera: new Three.PerspectiveCamera(), player: mine }),
        );
        const unlooked = yield* View.make([crates]);

        yield* play(views, [both]);
        yield* play(unlooked, [both]);

        expect(told).toEqual(['1 true', '2 false', '1 false', '2 false']);
      }),
  );
});

describe('View.each with nothing to draw', () => {
  it.effect(
    'builds an object for each entity, and leaves it as it was built, for what stands as it is laid',
    () =>
      Effect.gen(function* () {
        const laid = View.each([Crate, Position], {
          acquire: (held) =>
            Effect.sync(() => {
              const crate = new Three.Mesh();
              crate.position.x = held(Position).x;
              return crate;
            }),
        });
        const views = yield* View.make([laid]);
        const [first] = State.spawn(State.empty({ seed: 1 }), crateAt(2));
        const moved = State.finish(
          (() => {
            const draft = State.draft(first);
            for (const [crate] of State.queryIn(first)(Crate)) {
              State.write(draft, crate, Position, { x: 9 });
            }
            return draft;
          })(),
        );

        const shown = yield* play(views, [first, moved]);

        expect(shown.map((objects) => objects.map(({ position }) => position.x))).toEqual([
          [2],
          [2],
        ]);
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
        State.spawn(State.empty({ seed: 1 }), [Crate.of({}), Struck.of({ at: tick })])[0];
      const [bare] = State.spawn(State.empty({ seed: 1 }), [Crate.of({})]);

      yield* play(views, [bare, at(3), at(3), at(5)]);
      yield* Effect.yieldNow;

      expect(heard).toEqual([3, 5]);
    }),
  );
});

describe('View.during', () => {
  it.effect('holds what it acquires while a condition is true, and lets it go once it is not', () =>
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
      const [one] = State.spawn(State.empty({ seed: 1 }), crateAt(1));
      const [two] = State.spawn(one, crateAt(2));

      yield* play(views, [one, two, two, one]);

      expect(events).toEqual(['acquired', 'released']);
    }),
  );
});

describe('View.whole', () => {
  it.effect('builds its object once, and draws it every frame from the whole frame', () =>
    Effect.gen(function* () {
      const tally = View.whole({
        acquire: () => Effect.succeed(new Three.Group()),
        draw: (group, frame) => {
          group.position.x = frame.query(Crate).length;
        },
      });
      const views = yield* View.make([tally]);
      const [one] = State.spawn(State.empty({ seed: 1 }), crateAt(1));
      const [two] = State.spawn(one, crateAt(2));

      const [first] = yield* play(views, [one]);
      const drawnFirst = first?.map(({ position }) => position.x);
      const [second] = yield* play(views, [two]);

      expect(drawnFirst).toEqual([1]);
      expect(second?.map(({ position }) => position.x)).toEqual([2]);
      expect(second?.[0]).toBe(first?.[0]);
      expect(Option.map(views.whole(tally), ({ position }) => position.x)).toEqual(Option.some(2));
    }),
  );

  it.effect('lets go of what it built once the views close', () =>
    Effect.gen(function* () {
      const released: Array<string> = [];
      const tally = View.whole({
        acquire: () =>
          Effect.acquireRelease(Effect.succeed(new Three.Group()), () =>
            Effect.sync(() => {
              released.push('tally');
            }),
          ),
        draw: () => {},
      });
      const scope = yield* Scope.make();
      const views = yield* View.make([tally]).pipe(Scope.provide(scope));
      yield* play(views, [State.empty({ seed: 1 })]);
      const before = [...released];
      yield* Scope.close(scope, Exit.void);

      expect([before, released]).toEqual([[], ['tally']]);
    }),
  );
});

describe('View.follow', () => {
  it.effect(
    'puts out what follows from each frame, once as it comes to be and again only as it changes',
    () =>
      Effect.gen(function* () {
        const put: Array<number> = [];
        const crates = View.follow({
          of: (frame) => frame.query(Crate).length,
          to: (count) =>
            Effect.sync(() => {
              put.push(count);
            }),
        });
        const views = yield* View.make([crates]);
        const [one] = State.spawn(State.empty({ seed: 1 }), crateAt(1));
        const [two] = State.spawn(one, crateAt(2));

        yield* play(views, [one, one, two, two, one]);
        yield* Effect.yieldNow;

        expect(put).toEqual([1, 2, 1]);
      }),
  );

  it.effect('tells one value from another as told, such as colours by what they are', () =>
    Effect.gen(function* () {
      const put: Array<{ readonly lit: boolean }> = [];
      const lamp = View.follow({
        of: (frame) => ({ lit: frame.query(Crate).length > 0 }),
        same: (a, b) => a.lit === b.lit,
        to: (value) =>
          Effect.sync(() => {
            put.push(value);
          }),
      });
      const views = yield* View.make([lamp]);
      const [one] = State.spawn(State.empty({ seed: 1 }), crateAt(1));

      yield* play(views, [one, one]);
      yield* Effect.yieldNow;

      expect(put).toEqual([{ lit: true }]);
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
      yield* play(views, [State.spawn(State.empty({ seed: 1 }), [Crate.of({})])[0]]);

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
    const [one, left] = State.spawn(State.empty({ seed: 1 }), crateAt(0));
    const [two, right] = State.spawn(one, crateAt(2));
    const [state] = State.spawn(two, [Struck.of({ at: 1 })]);
    yield* play(views, [state]);
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
      const [state, crate] = State.spawn(State.empty({ seed: 1 }), crateAt(1));
      const [, loose] = State.spawn(state, [Position.of({ x: 2 })]);

      yield* play(views, [State.spawn(state, [Position.of({ x: 2 })])[0]]);

      expect(views.objectsOf(crate)).toEqual([
        Option.getOrThrow(views.find(boxes, crate)),
        Option.getOrThrow(views.find(marks, crate)),
      ]);
      expect(views.objectsOf(loose)).toHaveLength(1);
      expect(views.objectsOf(99)).toEqual([]);
    }),
  );
});

describe("the drawing's input", () => {
  /** Whose eyes the camera looks through, as the page keeps it. */
  type Looked = 'Eyes' | 'Shoulder';
  const [state, player] = State.spawn(State.empty({ seed: 1 }), [Position.of({ x: 2 })]);
  /** The camera through the player's eyes, or behind them, as the page says. */
  const camera = View.rig([Position], (camera, held, _frame, _drawn, looked: Looked) => {
    camera.position.set(held(Position).x, 1.6, looked === 'Eyes' ? 0 : 3);
  });

  it.effect('reaches the rigs as the page has it at each frame, nothing in the state', () =>
    Effect.gen(function* () {
      const page: { looked: Looked } = { looked: 'Shoulder' };
      const eye = new Three.PerspectiveCamera();
      const views = yield* View.make(
        [camera],
        Option.some({ camera: eye, player }),
        () => page.looked,
      );

      yield* play(views, [state]);
      const behind = eye.position.z;
      page.looked = 'Eyes';
      yield* play(views, [state]);

      expect([behind, eye.position.z]).toEqual([3, 0]);
    }),
  );

  it.effect('reaches every view drawn each frame, and a view that reads none takes any', () =>
    Effect.gen(function* () {
      const crates = View.each([Crate, Position], {
        acquire: () => Effect.succeed(new Three.Group()),
        draw: (group, _held, _frame, looked: Looked) => {
          group.visible = looked === 'Shoulder';
        },
      });
      const plain = View.each([Crate], {
        acquire: () => Effect.succeed(new Three.Group()),
        draw: () => {},
      });
      const views = yield* View.make([crates, plain], Option.none(), (): Looked => 'Eyes');
      const [crated] = State.spawn(State.empty({ seed: 1 }), crateAt(1));

      const [shown] = yield* play(views, [crated]);

      expect(shown?.map(({ visible }) => visible)).toEqual([false, true]);
    }),
  );

  it('is asked for by the views that read it', () => {
    // @ts-expect-error A rig that reads the drawing's input is not among the views that are given none.
    const views: ReadonlyArray<View.View<unknown, undefined>> = [camera];
    expect(views).toHaveLength(1);
  });
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
  const [state, player] = State.spawn(State.empty({ seed: 1 }), [Position.of({ x: 4 })]);
  const [withOther, other] = State.spawn(state, [Position.of({ x: 9 })]);

  it.effect('draws the camera for the player after every view has drawn, from what they drew', () =>
    Effect.gen(function* () {
      const camera = new Three.PerspectiveCamera();
      const views = yield* View.make([eyes, bodies], Option.some({ camera, player }));

      yield* play(views, [state]);

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
      const [crated] = State.spawn(withOther, crateAt(7));

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

      yield* play(views, [state]);

      expect(camera.position.y).toBeCloseTo(1.6);
    }),
  );

  it.effect('leaves rigs undrawn where the views are given no camera and no player', () =>
    Effect.gen(function* () {
      const views = yield* View.make([bodies, eyes]);

      const [drawn] = yield* play(views, [state]);

      expect(drawn).toHaveLength(1);
    }),
  );
});

describe('what views need', () => {
  /** Two services views put out through: a bell and a horn, each a list a test reads. */
  const Bell = Context.Service<{ readonly rung: Array<string> }>('Bell');
  const Horn = Context.Service<{ readonly blown: Array<string> }>('Horn');
  const rings = View.on(Struck, () =>
    Effect.gen(function* () {
      (yield* Bell).rung.push('ring');
    }),
  );
  const blows = View.on(Struck, () =>
    Effect.gen(function* () {
      (yield* Horn).blown.push('blow');
    }),
  );
  const behind = View.rig([Position], (camera, _held, _frame, _drawn, back: number) => {
    camera.position.z = back;
  });
  const [bare] = State.spawn(State.empty({ seed: 1 }), [Crate.of({})]);
  const [struck] = State.spawn(State.empty({ seed: 1 }), [Crate.of({}), Struck.of({ at: 1 })]);

  it.effect(
    'is all that each of them needs, worked out with nothing named, with an input or without',
    () => {
      const bell = { rung: new Array<string>() };
      const horn = { blown: new Array<string>() };
      return Effect.gen(function* () {
        const plain = yield* View.make([rings, blows]);
        const looked = yield* View.make([rings, blows, behind], Option.none(), () => 4);

        yield* play(plain, [bare, struck]);
        yield* play(looked, [bare, struck]);
        yield* Effect.yieldNow;

        expect([bell.rung, horn.blown]).toEqual([
          ['ring', 'ring'],
          ['blow', 'blow'],
        ]);
      }).pipe(Effect.scoped, Effect.provideService(Bell, bell), Effect.provideService(Horn, horn));
    },
  );
});

describe('the input views read', () => {
  /** A rig that reads where the player looks, and a view that reads how bright the page draws. */
  const turned = View.rig(
    [],
    (camera, _held, _frame, _drawn, { yaw }: { readonly yaw: number }) => {
      camera.rotation.y = yaw;
    },
  );
  const lit = View.each([Crate], {
    acquire: () => Effect.succeed(new Three.Mesh()),
    draw: (mesh, _held, _frame, { bright }: { readonly bright: boolean }) => {
      mesh.visible = bright;
    },
  });
  const plain = View.each([Crate], {
    acquire: () => Effect.succeed(new Three.Mesh()),
    draw: () => {},
  });

  it('is what every one of them reads, met in one value, and anything where none reads one', () => {
    const both: View.InputOf<[typeof turned, typeof lit, typeof plain]> = { yaw: 1, bright: true };
    const none: View.InputOf<[typeof plain]> = 'anything';
    // @ts-expect-error The rig reads where the player looks, which this lacks.
    const lacking: View.InputOf<[typeof turned, typeof lit]> = { bright: true };

    expect([both, none, lacking]).toHaveLength(3);
  });
});
