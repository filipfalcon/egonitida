import { Styled } from '@egonitida/foldkit';
import { Inspector } from '@egonitida/reflection';
import * as stylex from '@stylexjs/stylex';
import type { Html, HtmlBuilder } from 'foldkit/html';
import { form, viewDetails } from '#src/details.ts';
import { Message, type OutlineEntry, type Selected } from '#src/main.ts';
import * as Objects from '#src/objects.ts';
import { ui } from '#src/ui.ts';
// Relative, as StyleX finds variables by the path of the module that defines them.
import { colours } from './tokens.stylex.ts';

const styles = stylex.create({
  behaviour: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: colours.control,
  },
  rule: { marginBottom: 10, padding: 10, borderRadius: 6, backgroundColor: colours.page },
  remove: { padding: 0, backgroundColor: 'transparent', color: colours.danger },
});

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
    [...Styled.attributes(h, styles.rule), h.Key(String(index))],
    [
      h.div(Styled.attributes(h, form.property), [
        h.label([h.For(`${prefix}-kind`), ...Styled.attributes(h, form.label)], ['When clicked']),
        h.select(
          [
            h.Id(`${prefix}-kind`),
            ...Styled.attributes(h, form.field),
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
      ]),
      h.div(Styled.attributes(h, form.property), [
        h.label([h.For(`${prefix}-target`), ...Styled.attributes(h, form.label)], ['Target']),
        h.select(
          [
            h.Id(`${prefix}-target`),
            ...Styled.attributes(h, form.field),
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
      ]),
      viewDetails(
        h,
        settingsOf(reaction.change),
        reaction.change,
        (field, value) => Message.ChangedReactionSetting({ index, field, value }),
        prefix,
      ),
      h.button(
        [
          h.Type('button'),
          ...Styled.attributes(h, ui.button, styles.remove),
          h.OnClick(Message.ClickedRemoveReaction({ index })),
        ],
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
  h.section(Styled.attributes(h, styles.behaviour), [
    h.h2(Styled.attributes(h, ui.heading), ['Behaviour']),
    ...(selected.reactions.length === 0
      ? [
          h.p(Styled.attributes(h, ui.hint), [
            'No rules yet. Add one to make this object react to clicks.',
          ]),
        ]
      : selected.reactions.map((reaction, index) =>
          viewReaction(h, selected, outline, reaction, index),
        )),
    h.button(
      [
        h.Type('button'),
        ...Styled.attributes(h, ui.button),
        h.OnClick(Message.ClickedAddReaction()),
      ],
      ['+ Add rule'],
    ),
  ]);
