import { expect, it } from '@effect/vitest';
import { Scene } from '@lightocean/client';
import { Story } from '@lightocean/core';
import { Effect, Option } from 'effect';
import * as Three from 'three/webgpu';
import * as Figure from '#src/figure.ts';
import * as FigureView from '#src/figure.view.ts';
import * as Model from '#src/model.ts';

/** The weight the figure's body gives `target` now, if it carries it. */
const weightOf = (shaped: Three.Object3D, target: string) =>
  Option.flatMap(Option.fromNullishOr(shaped.getObjectByName(Model.BODY)), (body) =>
    body instanceof Three.Mesh
      ? Option.flatMap(Option.fromNullishOr(body.morphTargetDictionary?.[target]), (index) =>
          Option.fromNullishOr(body.morphTargetInfluences?.[index]),
        )
      : Option.none(),
  );

/** How high the figure's knee is, from her feet, if she has one. */
const kneeHeightOf = (shaped: Three.Object3D) =>
  Option.map(Option.fromNullishOr(shaped.getObjectByName('knee')), (knee) => knee.position.y);

it.effect('draws a figure shaped as her player turned her dials', () =>
  Effect.gen(function* () {
    const [joined, figure] = Figure.join(Figure.state);
    const shaped = Story.story(
      Figure.game,
      Story.given(joined, { figure }),
      Story.act('figure', Figure.TurnedDial, { dial: 'chest', toward: 'More' }),
      Story.step(),
      Story.act('figure', Figure.TurnedDial, { dial: 'hips', toward: 'Less' }),
      Story.step(),
      Story.act('figure', Figure.TurnedDial, { dial: 'legs', toward: 'More' }),
      Story.step(),
    );
    const scene = yield* Scene.make(FigureView.views);

    yield* scene.show(shaped.state);
    const drawn = scene.find(FigureView.figures, figure);

    expect(Option.flatMap(drawn, (it) => weightOf(it, 'chest-fuller'))).toEqual(
      Option.some(Figure.STEP),
    );
    expect(Option.flatMap(drawn, (it) => weightOf(it, 'hips-narrower'))).toEqual(
      Option.some(Figure.STEP),
    );
    expect(Option.flatMap(drawn, (it) => weightOf(it, 'hips-wider'))).toEqual(Option.some(0));
    expect(Option.getOrThrow(Option.flatMap(drawn, kneeHeightOf))).toBeCloseTo(
      Model.KNEE * (1 + Figure.STEP * FigureView.LEGS_BY),
    );
  }),
);
