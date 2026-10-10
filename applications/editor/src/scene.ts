import { Scene } from '@lightocean/engine';
import { Option } from 'effect';
import type { Document, Entity } from '#src/document.ts';
import { Message } from '#src/main.ts';

const outlineColor = 0xffb020;
// The outline sits just outside the body, so it shows around it rather than through it.
const outlineScale = 1.06;

const degrees = (value: number) => (value * Math.PI) / 180;

const geometryOf = (entity: Entity): Scene.Geometry =>
  entity.shape === 'Box'
    ? Scene.box({ width: 1, height: 1, depth: 1 })
    : Scene.sphere({ radius: 0.6 });

const entityNode = (entity: Entity, isSelected: boolean, select: Message): Scene.Node<Message> => {
  const body = Scene.mesh({
    key: 'body',
    geometry: geometryOf(entity),
    material: Scene.standard({ color: entity.color }),
    onClick: select,
  });
  const outline = Scene.mesh({
    key: 'outline',
    geometry: geometryOf(entity),
    material: Scene.basic({ color: outlineColor, wireframe: true }),
    scale: [outlineScale, outlineScale, outlineScale],
    onClick: select,
  });
  return Scene.group({
    key: entity.id,
    position: entity.position,
    rotation: [
      degrees(entity.rotation[0]),
      degrees(entity.rotation[1]),
      degrees(entity.rotation[2]),
    ],
    scale: entity.scale,
    ...(entity.spinSpeed === 0
      ? {}
      : { motion: Scene.spin({ axis: [0, 1, 0], speed: entity.spinSpeed }) }),
    children: isSelected ? [body, outline] : [body],
  });
};

const camera = Scene.perspectiveCamera({ position: [0, 4, 10], rotation: [-0.35, 0, 0] });

const lights: ReadonlyArray<Scene.Node<Message>> = [
  Scene.ambientLight({ key: 'ambient', intensity: 0.4 }),
  Scene.directionalLight({ key: 'sun', intensity: 2.5, position: [5, 8, 6] }),
];

/** The world the viewport draws while editing a document, with the selected entity outlined. */
export const toScene = (
  document: Document,
  maybeSelectedId: Option.Option<string>,
): Scene.Scene<Message> =>
  Scene.scene({
    camera,
    nodes: [
      ...lights,
      ...document.entities.map((entity) =>
        entityNode(
          entity,
          Option.exists(maybeSelectedId, (id) => id === entity.id),
          Message.SelectedEntity({ id: entity.id }),
        ),
      ),
    ],
    onClickNothing: Message.ClickedNothing(),
  });

/** The world the viewport draws while the document plays: a click goes to the running world. */
export const playScene = (world: Document): Scene.Scene<Message> =>
  Scene.scene({
    camera,
    nodes: [
      ...lights,
      ...world.entities.map((entity) =>
        entityNode(entity, false, Message.ClickedInWorld({ id: entity.id })),
      ),
    ],
  });
