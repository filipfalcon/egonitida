import { Option } from 'effect';
import type { Html, HtmlBuilder } from 'foldkit/html';
import type { Document } from '#src/document.ts';
import { Message, type Session } from '#src/main.ts';
import { changes } from '#src/play.ts';
import { toHex } from '#src/details.ts';

const nameIn = (world: Document, id: string) =>
  world.entities.find((entity) => entity.id === id)?.name ?? id;

/** The world just before an entry: the one the entry before it led to, or where the session started. */
const worldBefore = (session: Session, index: number): Document =>
  index === 0 ? session.initial : (session.entries[index - 1]?.world ?? session.initial);

const viewTimeline = (h: HtmlBuilder<Message>, session: Session, shownIndex: number): Html =>
  session.entries.length === 0
    ? h.p([h.Class('hint')], ['Click objects in the viewport to send the running world events.'])
    : h.ol(
        [h.Class('timeline')],
        session.entries.map((entry, index) =>
          h.li(
            [h.Key(String(index))],
            [
              h.button(
                [
                  h.Type('button'),
                  h.Class(index === shownIndex ? 'entry shown' : 'entry'),
                  h.AriaPressed(String(index === shownIndex)),
                  h.OnClick(Message.InspectedEntry({ index })),
                ],
                [
                  h.span([h.Class('index')], [`#${index + 1}`]),
                  ` ${entry.event._tag} · ${nameIn(worldBefore(session, index), entry.event.id)}`,
                ],
              ),
            ],
          ),
        ),
      );

const viewChanges = (h: HtmlBuilder<Message>, session: Session, shownIndex: number): Html => {
  const entry = session.entries[shownIndex];
  if (entry === undefined) {
    return h.p([h.Class('hint')], ['Nothing has happened yet.']);
  }
  const changed = changes(worldBefore(session, shownIndex), entry.world);
  return changed.length === 0
    ? h.p([h.Class('hint')], ['This event changed nothing.'])
    : h.ul(
        [h.Class('changes')],
        changed.map((change) => h.li([], [`${change.entityName} · ${change.key}`])),
      );
};

const viewModel = (h: HtmlBuilder<Message>, world: Document): Html =>
  h.pre(
    [h.Class('model')],
    [
      JSON.stringify(
        world.entities.map((entity) => ({
          name: entity.name,
          position: entity.position,
          rotation: entity.rotation,
          scale: entity.scale,
          color: toHex(entity.color),
          spinSpeed: entity.spinSpeed,
        })),
        null,
        2,
      ),
    ],
  );

/** What the running document has been through: its events, what each changed, and its Model at any of them. */
export const viewDebugger = (h: HtmlBuilder<Message>, session: Session, world: Document): Html => {
  const shownIndex = Option.getOrElse(
    session.maybeInspectedIndex,
    () => session.entries.length - 1,
  );
  return h.section(
    [h.Class('debugger')],
    [
      h.h2([], ['Debugger']),
      Option.match(session.maybeInspectedIndex, {
        onNone: () => h.p([h.Class('status live')], ['● Live']),
        onSome: (index) =>
          h.div(
            [h.Class('status paused')],
            [
              h.span([], [`❚❚ Paused at #${index + 1}`]),
              h.button([h.Type('button'), h.OnClick(Message.ClickedLive())], ['Back to live']),
            ],
          ),
      }),
      h.h3([], ['Events']),
      viewTimeline(h, session, shownIndex),
      h.h3([], ['Changes']),
      viewChanges(h, session, shownIndex),
      h.h3([], ['Model']),
      viewModel(h, world),
    ],
  );
};
