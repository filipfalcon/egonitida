import { describe, expect, it } from '@effect/vitest';
import type { Scene } from '@lightocean/engine';
import { Option } from 'effect';
import { type Entity, makeEntity } from '#src/document.ts';
import { Message } from '#src/main.ts';
import { playScene, toScene } from '#src/scene.ts';

const box: Entity = {
  ...makeEntity('Box', 1),
  position: [1, 2, 3],
  rotation: [0, 90, 0],
  scale: [2, 2, 2],
  color: 0x123456,
  spinSpeed: 1.5,
};
const sphere: Entity = { ...makeEntity('Sphere', 2), spinSpeed: 0 };
const document = { entities: [box, sphere] };

const groups = (scene: Scene.Scene<Message>) =>
  scene.nodes.filter((node): node is Scene.Group<Message> => node._tag === 'Group');

const child = (group: Scene.Group<Message> | undefined, key: string) =>
  group?.children.find(
    (node): node is Scene.Mesh<Message> => node.key === key && node._tag === 'Mesh',
  );

describe('toScene', () => {
  it('declares one group per entity, keyed by its id, in its transform', () => {
    const [first] = groups(toScene(document, Option.none()));

    expect(first?.key).toBe(box.id);
    expect(first?.position).toEqual([1, 2, 3]);
    expect(first?.rotation[1]).toBeCloseTo(Math.PI / 2);
    expect(first?.scale).toEqual([2, 2, 2]);
  });

  it('spins an entity with a spin speed, and only those', () => {
    const [first, second] = groups(toScene(document, Option.none()));

    expect(first?.motion).toEqual(Option.some({ _tag: 'Spin', axis: [0, 1, 0], speed: 1.5 }));
    expect(second?.motion).toEqual(Option.none());
  });

  it('draws the body in the entity’s shape and colour, selecting the entity on click', () => {
    const [first, second] = groups(toScene(document, Option.none()));
    const body = child(first, 'body');

    expect(body?.geometry._tag).toBe('Box');
    expect(body?.material).toEqual({ _tag: 'Standard', color: 0x123456, wireframe: false });
    expect(body?.onClick).toEqual(Option.some(Message.SelectedEntity({ id: box.id })));
    expect(child(second, 'body')?.geometry._tag).toBe('Sphere');
  });

  it('outlines the selected entity only', () => {
    const [first, second] = groups(toScene(document, Option.some(sphere.id)));
    const outline = child(second, 'outline');

    expect(child(first, 'outline')).toBeUndefined();
    expect(outline?.material._tag).toBe('Basic');
    expect(outline?.material.wireframe).toBe(true);
    expect(outline?.onClick).toEqual(Option.some(Message.SelectedEntity({ id: sphere.id })));
  });

  it('clears the selection on a click that hits nothing', () => {
    expect(toScene(document, Option.none()).onClickNothing).toEqual(
      Option.some(Message.ClickedNothing()),
    );
  });

  it('lights the scene', () => {
    const tags = toScene(document, Option.none()).nodes.map((node) => node._tag);

    expect(tags).toContain('AmbientLight');
    expect(tags).toContain('DirectionalLight');
  });
});

describe('playScene', () => {
  it('sends a click on an entity to the running world', () => {
    const [first] = groups(playScene(document));

    expect(child(first, 'body')?.onClick).toEqual(
      Option.some(Message.ClickedInWorld({ id: box.id })),
    );
  });

  it('draws no outline and leaves a click on nothing alone', () => {
    const scene = playScene(document);

    expect(groups(scene).every((group) => child(group, 'outline') === undefined)).toBe(true);
    expect(scene.onClickNothing).toEqual(Option.none());
  });
});
