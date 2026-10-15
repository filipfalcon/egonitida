import { View } from '@nitida/client';
import { Effect, Option } from 'effect';
import * as Three from 'three/webgpu';
import * as Editing from '#src/editing.ts';
import * as Objects from '#src/objects.ts';

/** How much larger than an object its outline is, so the outline shows around it. */
const MARGIN = 1.1;

/** Where an outline's box is worked out each frame; nothing is kept in them between frames. */
const centre = new Three.Vector3();
const size = new Three.Vector3();

/** What each editor has selected, outlined around where it stands, as large as it is; nothing while they have nothing selected. */
export const selections = View.each([Editing.Selection], {
  acquire: () =>
    Effect.acquireRelease(
      Effect.sync(() => new Three.Box3Helper(new Three.Box3(), 0xffffff)),
      (outline) => Effect.sync(() => outline.dispose()),
    ),
  draw: (outline, held, frame) => {
    const transform = Option.flatMap(held(Editing.Selection).selected, (selected) =>
      frame.get(selected, Objects.Transform),
    );
    outline.visible = Option.isSome(transform);
    if (Option.isSome(transform)) {
      const { position, scale } = transform.value;
      centre.set(position[0], position[1], position[2]);
      size.set(scale[0], scale[1], scale[2]).multiplyScalar(MARGIN);
      outline.box.setFromCenterAndSize(centre, size);
    }
  },
});

/** The views of what editing adds to the drawing. */
export const views = [selections];
