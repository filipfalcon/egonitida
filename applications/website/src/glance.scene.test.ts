import { expect, it } from '@effect/vitest';
import { Scene, View } from '@lightocean/client';
import { Story, State } from '@lightocean/core';
import { Effect, Option } from 'effect';
import * as Three from 'three/webgpu';
import * as Glance from '#src/glance.ts';
import * as GlanceView from '#src/glance.view.ts';

const [withViewer, viewer] = Glance.setup.join(Glance.state);

/** The viewer going on to the next beat. */
const goneOn = [Story.act('viewer', Glance.ChoseNext, {}), Story.step()];

/** `state` told on with `then`, the viewer still watching. */
const on = (state: State.State, ...then: ReadonlyArray<Story.Step>) =>
  Story.story(Glance.game, Story.given(state, { viewer }), ...then).state;

/** The state `seconds` into the ideas, as the viewer starts the telling and goes on to them. */
const ideasFor = (seconds: number) =>
  on(
    withViewer,
    Story.act('viewer', Glance.ChoseStart, {}),
    Story.step(),
    ...goneOn,
    Story.seconds(seconds),
  );

/** The state as it emerges, the viewer going on to it a second into the ideas. */
const emerged = on(ideasFor(1), ...goneOn);

/** The state `seconds` into `beat`, the viewer going on to it a few seconds into every beat from the state's; as time starts ticking, begun anew by its host. */
const at = (beat: Glance.Moment, seconds: number) => {
  const reached = on(
    emerged,
    ...Array.from(
      { length: Glance.Moment.literals.indexOf(beat) - Glance.Moment.literals.indexOf('State') },
      () => [Story.seconds(3), ...goneOn],
    ).flat(),
  );
  return on(beat === 'Step' ? Glance.begun(reached) : reached, Story.seconds(seconds));
};

const first = (state: State.State, component: Parameters<typeof State.holding>[1][number]) =>
  Option.fromNullishOr(State.holding(state, [component])[0]);

it.effect('draws each idea drifting in from beyond the edges', () =>
  Effect.gen(function* () {
    const scene = yield* Scene.make(GlanceView.views);
    const coming = ideasFor(0.3);
    const idea = first(coming, Glance.Idea);
    const awayIn = (state: State.State) =>
      Effect.map(scene.show(state), () =>
        Option.flatMap(idea, (entity) =>
          Option.map(scene.find(GlanceView.ideas, entity), ({ position }) => position.length()),
        ),
      );

    const far = yield* awayIn(coming);
    const near = yield* awayIn(ideasFor(2.5));

    expect(Option.map(Option.all([far, near]), ([out, inside]) => inside < out)).toEqual(
      Option.some(true),
    );
  }),
);

it.effect(
  'presses the ideas, once they have all come, ever smaller into one point, and keeps them there',
  () =>
    Effect.gen(function* () {
      const scene = yield* Scene.make(GlanceView.views);
      const late = ideasFor(20);
      yield* scene.show(late);
      const sizes = State.holding(late, [Glance.Idea]).map((idea) =>
        Option.map(scene.find(GlanceView.ideas, idea), ({ scale }) => scale.x),
      );

      expect(sizes.length).toBeGreaterThan(0);
      expect(sizes.every((size) => Option.exists(size, (scale) => scale < 0.2))).toBe(true);
    }),
);

it.effect('draws the point small and heavy as the state emerges, and then its bang spreading', () =>
  Effect.gen(function* () {
    const scene = yield* Scene.make(GlanceView.views);
    const heartIn = (state: State.State) =>
      Effect.map(scene.show(state), () =>
        Option.flatMap(first(state, Glance.Bang), (bang) =>
          Option.flatMap(scene.find(GlanceView.bang, bang), (drawn) =>
            Option.map(
              Option.fromNullishOr(drawn.getObjectByName('heart')),
              ({ scale }) => scale.x,
            ),
          ),
        ),
      );

    const point = yield* heartIn(at('State', 0.5));
    const bursting = yield* heartIn(at('State', 3));

    expect(Option.map(point, (size) => size < 0.5)).toEqual(Option.some(true));
    expect(Option.map(Option.all([point, bursting]), ([small, large]) => large > small)).toEqual(
      Option.some(true),
    );
  }),
);

it.effect(
  'draws every entity coming out of the middle into a row, each alike, and no planet yet',
  () =>
    Effect.gen(function* () {
      const scene = yield* Scene.make(GlanceView.views);
      const emerging = at('Entities', 5);
      yield* scene.show(emerging);
      const drawn = State.holding(emerging, [Glance.Body]).map((entity) =>
        scene.find(GlanceView.bare, entity),
      );
      const sizes = drawn.map((object) => Option.map(object, ({ scale }) => scale.x));
      const across = drawn.map((object) =>
        Option.getOrElse(
          Option.map(object, ({ position }) => position.x),
          () => Number.NaN,
        ),
      );

      expect(drawn).toHaveLength(Glance.PLANETS);
      expect(new Set(sizes.map((size) => Option.getOrElse(size, () => Number.NaN))).size).toBe(1);
      expect(new Set(across).size).toBe(Glance.PLANETS);
      expect(State.holding(emerging, [Glance.Look])).toEqual([]);
    }),
);

it.effect(
  'draws each entity taking the look and the place it is given, and going round once time starts ticking',
  () =>
    Effect.gen(function* () {
      const scene = yield* Scene.make(GlanceView.views);
      const given = at('Components', 0);
      const planet = first(given, Glance.Look);
      const drawnIn = (state: State.State) =>
        Effect.map(scene.show(state), () =>
          Option.flatMap(planet, (entity) =>
            Option.map(scene.find(GlanceView.planets, entity), ({ scale, position }) => ({
              size: scale.x,
              out: Math.hypot(position.x, position.z),
              x: position.x,
            })),
          ),
        );
      const look = Option.flatMap(planet, (entity) => State.get(given, entity, Glance.Look));
      const place = Option.flatMap(planet, (entity) => State.get(given, entity, Glance.Place));

      const taking = yield* drawnIn(given);
      const taken = yield* drawnIn(on(given, Story.seconds(3)));
      const ticking = at('Step', 0.5);
      const goneRound = yield* drawnIn(on(ticking, Story.seconds(1)));
      const before = yield* drawnIn(ticking);

      expect(
        Option.map(Option.all([taking, look]), ([drawn, { radius }]) => drawn.size < radius),
      ).toEqual(Option.some(true));
      expect(Option.map(taken, ({ size }) => size)).toEqual(
        Option.map(look, ({ radius }) => radius),
      );
      expect(
        Option.map(
          Option.all([taken, place]),
          ([drawn, { distance }]) => Math.abs(drawn.out - distance) < 1e-6,
        ),
      ).toEqual(Option.some(true));
      expect(
        Option.map(Option.all([before, goneRound]), ([earlier, later]) => earlier.x !== later.x),
      ).toEqual(Option.some(true));
    }),
);

it.effect('draws the state a frame to a step in the film strip', () =>
  Effect.gen(function* () {
    const scene = yield* Scene.make(GlanceView.stepViews);
    const ticking = at('Step', 1);
    yield* scene.show(ticking);

    const frames = Option.flatMap(first(ticking, Glance.Bang), (bang) =>
      Option.map(
        scene.find(GlanceView.film, bang),
        (strip) =>
          Array.from({ length: GlanceView.FRAMES }, (_, index) =>
            strip.getObjectByName(`frame-${index}`),
          ).filter((frame) => frame !== undefined).length,
      ),
    );

    expect(frames).toEqual(Option.some(GlanceView.FRAMES));
  }),
);

it.effect('lines the entities up as an array, each in a slot of its own between its brackets', () =>
  Effect.gen(function* () {
    const scene = yield* Scene.make(GlanceView.entityViews);
    const emerging = at('Entities', 5);
    yield* scene.show(emerging);

    const across = State.holding(emerging, [Glance.Body]).map((entity) =>
      Option.getOrElse(
        Option.map(scene.find(GlanceView.entityArray, entity), ({ position }) => position.x),
        () => Number.NaN,
      ),
    );
    const brackets = Option.flatMap(first(emerging, Glance.Bang), (bang) =>
      Option.map(scene.find(GlanceView.delimiters, bang), ({ visible }) => visible),
    );

    expect(across).toHaveLength(Glance.PLANETS);
    expect(new Set(across).size).toBe(Glance.PLANETS);
    expect(brackets).toEqual(Option.some(true));
  }),
);

it.effect(
  'draws the state in the stage above the band its line is told in, and in the middle of its pane',
  () =>
    Effect.gen(function* () {
      const point = at('State', 0.5);
      const heightIn = (views: ReadonlyArray<View.View>) =>
        Effect.gen(function* () {
          const scene = yield* Scene.make(views, Option.some(viewer));
          yield* scene.show(point);
          scene.camera.updateMatrixWorld();
          return Option.map(
            Option.flatMap(first(point, Glance.Bang), (bang) => scene.find(GlanceView.bang, bang)),
            (drawn) => drawn.getWorldPosition(new Three.Vector3()).project(scene.camera).y,
          );
        });

      const onStage = yield* heightIn(GlanceView.views);
      const inPane = yield* heightIn(GlanceView.stateViews);

      expect(Option.map(onStage, (height) => height > 0.2)).toEqual(Option.some(true));
      expect(Option.map(inPane, (height) => Math.abs(height) < 0.15)).toEqual(Option.some(true));
    }),
);
