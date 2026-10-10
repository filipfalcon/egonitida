import { describe, expect, it } from '@effect/vitest';
import { Option } from 'effect';
import { Message, type Model, initialModel, palette, update, viewScene } from '#src/main.ts';

const after = (messages: ReadonlyArray<Message>, model: Model = initialModel): Model =>
  messages.reduce((current, message) => update(current, message).model, model);

const meshes = (model: Model) => viewScene(model).nodes.filter((node) => node._tag === 'Mesh');

describe('playground', () => {
  describe('update', () => {
    it('starts with no cubes and no viewport', () => {
      expect(initialModel.cubes).toEqual([]);
      expect(initialModel.isViewportMounted).toBe(false);
    });

    it('spawns cubes with fresh ids, in the first colour', () => {
      const model = after([Message.ClickedSpawnCube(), Message.ClickedSpawnCube()]);

      expect(model.cubes).toEqual([
        { id: 0, color: palette[0] },
        { id: 1, color: palette[0] },
      ]);
    });

    it('moves a clicked cube on to the next colour, leaving the others', () => {
      const model = after([
        Message.ClickedSpawnCube(),
        Message.ClickedSpawnCube(),
        Message.ClickedCube({ id: 1 }),
      ]);

      expect(model.cubes).toEqual([
        { id: 0, color: palette[0] },
        { id: 1, color: palette[1] },
      ]);
    });

    it('wraps a cube back to the first colour after the last', () => {
      const clicks = palette.map(() => Message.ClickedCube({ id: 0 }));
      const model = after([Message.ClickedSpawnCube(), ...clicks]);

      expect(model.cubes[0]?.color).toBe(palette[0]);
    });

    it('records that the viewport mounted', () => {
      expect(after([Message.SucceededMountViewport()]).isViewportMounted).toBe(true);
    });

    it('records why the viewport failed to mount', () => {
      const model = after([Message.FailedMountViewport({ reason: 'No GPU.' })]);

      expect(model.maybeViewportError).toEqual(Option.some('No GPU.'));
    });
  });

  describe('viewScene', () => {
    it('lights the scene', () => {
      const tags = viewScene(initialModel).nodes.map((node) => node._tag);

      expect(tags).toContain('AmbientLight');
      expect(tags).toContain('DirectionalLight');
    });

    it('declares one spinning, clickable mesh per cube, in its colour', () => {
      const model = after([
        Message.ClickedSpawnCube(),
        Message.ClickedSpawnCube(),
        Message.ClickedCube({ id: 1 }),
      ]);

      const [first, second] = meshes(model);
      expect(first?.key).toBe('cube-0');
      expect(first?.material.color).toBe(palette[0]);
      expect(first?.onClick).toEqual(Option.some(Message.ClickedCube({ id: 0 })));
      expect(second?.material.color).toBe(palette[1]);
      expect(Option.isSome(second?.motion ?? Option.none())).toBe(true);
    });

    it('places every cube somewhere of its own', () => {
      const model = after(Array.from({ length: 8 }, () => Message.ClickedSpawnCube()));
      const positions = new Set(meshes(model).map((mesh) => mesh.position.join(',')));

      expect(positions.size).toBe(8);
    });
  });
});
