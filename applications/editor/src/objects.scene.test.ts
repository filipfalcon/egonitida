import { expect, it } from '@effect/vitest';
import { Scene } from '@nitida/client';
import { Story } from '@nitida/core';
import { Effect, Option } from 'effect';
import * as Three from 'three/webgpu';
import * as Editing from '#src/editing.ts';
import * as Objects from '#src/objects.ts';
import * as ObjectsView from '#src/objects.view.ts';

/** The new document, edited a little, a step on, so each object has turned. */
const edited = () =>
  Story.story(
    Editing.game,
    Story.given(Editing.joined.state, {
      editor: Editing.joined.editor,
      box: Editing.box,
      sphere: Editing.sphere,
    }),
    Story.act('editor', Editing.EditedProperty, {
      entity: Editing.box,
      component: 'Transform',
      field: 'rotation',
      value: [90, 0, 0],
    }),
    Story.act('editor', Editing.EditedProperty, {
      entity: Editing.box,
      component: 'Transform',
      field: 'scale',
      value: [2, 1, 1],
    }),
    Story.act('editor', Editing.EditedProperty, {
      entity: Editing.sphere,
      component: 'Shape',
      field: 'kind',
      value: 'Box',
    }),
    Story.step(),
  );

it.effect(
  'draws every object as its shape, where it stands, turned, sized, and in its colour',
  () =>
    Effect.gen(function* () {
      const told = edited();
      const scene = yield* Scene.make(ObjectsView.views);

      yield* scene.show(told.state);

      const box = scene.find(ObjectsView.objects, Editing.box);
      const { position } = Story.valueOf(told, 'box', Objects.Transform);
      expect(Option.map(box, (mesh) => mesh.position.toArray())).toEqual(
        Option.some([...position]),
      );
      expect(Option.map(box, (mesh) => mesh.rotation.x)).toEqual(Option.some(Math.PI / 2));
      expect(Option.map(box, (mesh) => mesh.scale.toArray())).toEqual(Option.some([2, 1, 1]));
      expect(Option.map(box, (mesh) => mesh.material.color.getHex())).toEqual(
        Option.some(Story.valueOf(told, 'box', Objects.Colour).hex),
      );
      // The sphere was made a box: it is drawn as one.
      const sphere = scene.find(ObjectsView.objects, Editing.sphere);
      expect(Option.map(sphere, (mesh) => mesh.geometry instanceof Three.BoxGeometry)).toEqual(
        Option.some(true),
      );
    }),
);

it.effect('turns every object about its upright as far as it has turned', () =>
  Effect.gen(function* () {
    const told = edited();
    const later = Story.seconds(1)(told);
    const scene = yield* Scene.make(ObjectsView.views);
    const turned = (angle: number) =>
      Option.map(
        scene.find(ObjectsView.objects, Editing.sphere),
        (mesh) => mesh.rotation.y - angle,
      );

    yield* scene.show(told.state);
    const before = turned(Story.valueOf(told, 'sphere', Objects.Turn).angle);
    yield* scene.show(later.state);
    const after = turned(Story.valueOf(later, 'sphere', Objects.Turn).angle);

    expect(before).toEqual(Option.some(0));
    expect(after).toEqual(Option.some(0));
    expect(Story.valueOf(later, 'sphere', Objects.Turn).angle).toBeGreaterThan(0.4);
  }),
);
