import { Inspector } from '@lightocean/reflection';
import type { Html, HtmlBuilder } from 'foldkit/html';
import { viewDetails } from '#src/details.ts';
import { Message, type OutlineEntry, type Selected } from '#src/main.ts';
import * as Objects from '#src/objects.ts';

/** What each kind of change is called. */
const TITLES: Record<Objects.ChangeKind, string> = {
  Recolour: 'Set colour',
  MoveBy: 'Move by',
  SetSpin: 'Set spin',
};

const KINDS: ReadonlyArray<Objects.ChangeKind> = ['Recolour', 'MoveBy', 'SetSpin'];

const isKind = (chosen: string): chosen is Objects.ChangeKind =>
  KINDS.some((kind) => kind === chosen);

/** The settings a change shows, from its own kind's schema. */
const settingsOf = (change: Objects.Change): ReadonlyArray<Inspector.Property> => {
  switch (change._tag) {
    case 'Recolour':
      return Inspector.properties(Objects.Recolour);
    case 'MoveBy':
      return Inspector.properties(Objects.MoveBy);
    case 'SetSpin':
      return Inspector.properties(Objects.SetSpin);
  }
};

/** The target a reaction names, as its select holds it. */
const chosenOf = (target: Objects.Target) =>
  target._tag === 'Itself' ? 'itself' : String(target.entity);

const viewReaction = (
  h: HtmlBuilder<Message>,
  selected: Selected,
  outline: ReadonlyArray<OutlineEntry>,
  reaction: Objects.Reaction,
  index: number,
): Html => {
  const prefix = `reaction-${selected.entity}-${index}`;
  return h.div(
    [h.Class('rule'), h.Key(String(index))],
    [
      h.div(
        [h.Class('property')],
        [
          h.label([h.For(`${prefix}-kind`)], ['When clicked']),
          h.select(
            [
              h.Id(`${prefix}-kind`),
              h.OnChange((kind) =>
                Message.ChangedReactionKind({
                  index,
                  kind: isKind(kind) ? kind : reaction.change._tag,
                }),
              ),
            ],
            KINDS.map((kind) =>
              h.option([h.Value(kind), h.Selected(kind === reaction.change._tag)], [TITLES[kind]]),
            ),
          ),
        ],
      ),
      h.div(
        [h.Class('property')],
        [
          h.label([h.For(`${prefix}-target`)], ['Target']),
          h.select(
            [
              h.Id(`${prefix}-target`),
              h.OnChange((target) => Message.ChangedReactionTarget({ index, target })),
            ],
            [
              h.option(
                [h.Value('itself'), h.Selected(reaction.target._tag === 'Itself')],
                ['Itself'],
              ),
              ...outline
                .filter(({ entity }) => entity !== selected.entity)
                .map(({ entity, name }) =>
                  h.option(
                    [
                      h.Value(String(entity)),
                      h.Selected(chosenOf(reaction.target) === String(entity)),
                    ],
                    [name],
                  ),
                ),
            ],
          ),
        ],
      ),
      viewDetails(
        h,
        settingsOf(reaction.change),
        reaction.change,
        (field, value) => Message.ChangedReactionSetting({ index, field, value }),
        prefix,
      ),
      h.button(
        [h.Type('button'), h.Class('remove'), h.OnClick(Message.ClickedRemoveReaction({ index }))],
        ['Remove rule'],
      ),
    ],
  );
};

/** What the selected object does when clicked while the document plays. */
export const viewBehaviour = (
  h: HtmlBuilder<Message>,
  selected: Selected,
  outline: ReadonlyArray<OutlineEntry>,
): Html =>
  h.section(
    [h.Class('behaviour')],
    [
      h.h2([], ['Behaviour']),
      ...(selected.reactions.length === 0
        ? [h.p([h.Class('hint')], ['No rules yet. Add one to make this object react to clicks.'])]
        : selected.reactions.map((reaction, index) =>
            viewReaction(h, selected, outline, reaction, index),
          )),
      h.button([h.Type('button'), h.OnClick(Message.ClickedAddReaction())], ['+ Add rule']),
    ],
  );
