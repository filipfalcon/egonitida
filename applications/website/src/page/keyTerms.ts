import * as Markdown from '@foldkit/markdown';
import type { HtmlBuilder } from 'foldkit/html';
import { islandAttributes } from '#src/islands.ts';
import type { DocsPage } from '#src/layout/docs.ts';
import { Message, type Model } from '#src/main.ts';
import { livePage } from '#src/markdown/index.ts';
import raw from '#src/page/keyTerms.md';
import * as GlanceStage from '#src/glanceStage.ts';
import * as StatePressView from '#src/statePressView.ts';

const page = livePage(raw);

/** The terms the whole engine is told in, each explained, with the stage of First Things First above their overview and the state press beside the state. */
export const view = (model: Model, h: HtmlBuilder<Message>): DocsPage => ({
  tableOfContents: page.tableOfContents,
  content: page.contentWith(
    Markdown.islandsFor(islandAttributes, {
      FirstThingsFirst: () =>
        h.submodel({
          slotId: 'first-things-first',
          model: model.glance,
          view: GlanceStage.view,
          toParentMessage: (message) => Message.GotGlanceMessage({ message }),
        }),
      StatePress: () =>
        h.submodel({
          slotId: 'state-press',
          model: model.statePress,
          view: StatePressView.view,
          toParentMessage: (message) => Message.GotStatePressMessage({ message }),
        }),
    }),
  ),
});
