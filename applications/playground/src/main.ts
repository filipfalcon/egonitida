import { Scene } from '@lightocean/engine';
import { Option, Schema } from 'effect';
import type { Runtime, Update } from 'foldkit';
import { defineMessageUnion } from 'foldkit/message';
import { modifyFields } from 'foldkit/struct';

// MODEL

export const Cube = Schema.Struct({ id: Schema.Int, color: Schema.Int });
export type Cube = typeof Cube.Type;

export const Model = Schema.Struct({
  cubes: Schema.Array(Cube),
  nextCubeId: Schema.Int,
  isViewportMounted: Schema.Boolean,
  maybeViewportError: Schema.Option(Schema.String),
});
export type Model = typeof Model.Type;

/** The colours a cube steps through, one per click. */
export const palette: ReadonlyArray<number> = [0x4f8cff, 0xff6b6b, 0x51cf66, 0xfcc419, 0xcc5de8];

// MESSAGE

export const Message = defineMessageUnion({
  ClickedSpawnCube: {},
  ClickedCube: { id: Schema.Int },
  SucceededMountViewport: {},
  FailedMountViewport: { reason: Schema.String },
});
export type Message = typeof Message.Type;

// UPDATE

const nextColor = (color: number): number =>
  palette[(palette.indexOf(color) + 1) % palette.length] ?? color;

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    ClickedSpawnCube: () => ({
      model: modifyFields(model, {
        cubes: (cubes) => [...cubes, { id: model.nextCubeId, color: palette[0] ?? 0xffffff }],
        nextCubeId: (id) => id + 1,
      }),
    }),
    ClickedCube: ({ id }) => ({
      model: modifyFields(model, {
        cubes: (cubes) =>
          cubes.map((cube) => (cube.id === id ? { ...cube, color: nextColor(cube.color) } : cube)),
      }),
    }),
    SucceededMountViewport: () => ({
      model: modifyFields(model, { isViewportMounted: () => true }),
    }),
    FailedMountViewport: ({ reason }) => ({
      model: modifyFields(model, { maybeViewportError: () => Option.some(reason) }),
    }),
  });

// INIT

export const initialModel: Model = {
  cubes: [],
  nextCubeId: 0,
  isViewportMounted: false,
  maybeViewportError: Option.none(),
};

export const init: Runtime.ApplicationInit<Model, Message> = () => ({ model: initialModel });

// SCENE

const cubesPerRow = 4;
const spacing = 2;

const cubeNode = (cube: Cube, index: number): Scene.Node<Message> =>
  Scene.mesh({
    key: `cube-${cube.id}`,
    geometry: Scene.box({ width: 1, height: 1, depth: 1 }),
    material: Scene.standard({ color: cube.color }),
    position: [
      ((index % cubesPerRow) - (cubesPerRow - 1) / 2) * spacing,
      0,
      -Math.floor(index / cubesPerRow) * spacing,
    ],
    motion: Scene.spin({ axis: [0.3, 1, 0.2], speed: 0.8 + (cube.id % 3) * 0.3 }),
    onClick: Message.ClickedCube({ id: cube.id }),
  });

export const viewScene = (model: Model): Scene.Scene<Message> =>
  Scene.scene({
    camera: Scene.perspectiveCamera({ position: [0, 3, 10], rotation: [-0.25, 0, 0] }),
    nodes: [
      Scene.ambientLight({ key: 'ambient', intensity: 0.4 }),
      Scene.directionalLight({ key: 'sun', intensity: 2.5, position: [5, 8, 6] }),
      ...model.cubes.map(cubeNode),
    ],
  });
