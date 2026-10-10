import { Option } from 'effect';
import type { Document, HtmlBuilder } from 'foldkit/html';
import { Message, type Model } from '#src/main.ts';
import { MountViewport, VIEWPORT_ID } from '#src/viewport.ts';

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: 'LightOcean Playground',
  body: h.main(
    [h.Class('playground')],
    [
      h.canvas(
        [
          h.Id(VIEWPORT_ID),
          h.Class('viewport'),
          h.OnMount(MountViewport({ viewportId: VIEWPORT_ID })),
        ],
        [],
      ),
      h.div(
        [h.Class('overlay')],
        [
          h.button([h.Type('button'), h.OnClick(Message.ClickedSpawnCube())], ['Spawn cube']),
          h.p([], [`${model.cubes.length} ${model.cubes.length === 1 ? 'cube' : 'cubes'}`]),
          ...Option.match(model.maybeViewportError, {
            onNone: () => [],
            onSome: (reason) => [h.p([h.Class('error')], [reason])],
          }),
        ],
      ),
    ],
  ),
});
