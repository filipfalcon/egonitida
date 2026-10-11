import { Option } from 'effect';
import type { Document, HtmlBuilder } from 'foldkit/html';
import { Message, type Model } from '#src/main.ts';
import { CANVAS_ID, MountCanvas } from '#src/world.ts';

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: 'LightOcean Playground',
  body: h.main(
    [h.Class('playground')],
    [
      // The canvas is in the page while the world is joined, and goes with it.
      ...(model.isWorldJoined
        ? [h.canvas([h.Id(CANVAS_ID), h.Class('viewport'), h.OnMount(MountCanvas())], [])]
        : []),
      h.div(
        [h.Class('overlay')],
        [
          h.button(
            [
              h.Type('button'),
              h.Disabled(!model.isWorldJoined),
              h.OnClick(Message.ClickedSpawnCube()),
            ],
            ['Spawn cube'],
          ),
          h.p([], [`${model.cubeCount} ${model.cubeCount === 1 ? 'cube' : 'cubes'}`]),
          ...Option.match(model.maybeError, {
            onNone: () => [],
            onSome: (reason) => [h.p([h.Class('error')], [reason])],
          }),
        ],
      ),
    ],
  ),
});
