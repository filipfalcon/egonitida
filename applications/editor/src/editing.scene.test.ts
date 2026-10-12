import { expect, it } from '@effect/vitest';
import { Scene } from '@lightocean/client';
import { Pointing, Story } from '@lightocean/core';
import { Effect, Option } from 'effect';
import * as Editing from '#src/editing.ts';
import * as EditingView from '#src/editing.view.ts';
import * as Objects from '#src/objects.ts';

const given = Story.given(Editing.joined.state, {
  editor: Editing.joined.editor,
  sphere: Editing.sphere,
});

it.effect(
  'outlines the object an editor has selected, around where it stands, and nothing once they let go',
  () =>
    Effect.gen(function* () {
      const selected = Story.story(
        Editing.game,
        given,
        Story.act('editor', Pointing.Clicked, { entity: Editing.sphere }),
        Story.step(),
      );
      const letGo = Story.story(
        Editing.game,
        Story.given(selected.state, { editor: Editing.joined.editor }),
        Story.act('editor', Editing.Deselected, {}),
        Story.step(),
      );
      const scene = yield* Scene.make(EditingView.views);
      const outline = () => scene.find(EditingView.selections, Editing.joined.editor);

      yield* scene.show(selected.state);
      const around = Option.map(outline(), ({ visible, box }) => ({
        visible,
        centre: box.getCenter(box.min.clone()).toArray(),
      }));
      yield* scene.show(letGo.state);
      const gone = Option.map(outline(), ({ visible }) => visible);

      expect(around).toEqual(
        Option.some({
          visible: true,
          centre: [...Story.valueOf(selected, 'sphere', Objects.Transform).position],
        }),
      );
      expect(gone).toEqual(Option.some(false));
    }),
);
