import { Schema } from 'effect';
import type { Html, HtmlBuilder } from 'foldkit/html';
import { viewDetails } from '#src/details.ts';
import {
  type Entity,
  type Rule,
  SELF,
  actionKinds,
  actionProperties,
  actionTitles,
} from '#src/document.ts';
import { Message } from '#src/main.ts';

const isActionKind = Schema.is(Schema.Literals(actionKinds));

const settingsOf = (rule: Rule) => actionProperties(rule.action._tag);

const viewRule = (
  h: HtmlBuilder<Message>,
  entity: Entity,
  entities: ReadonlyArray<Entity>,
  rule: Rule,
): Html => {
  const ids = { entityId: entity.id, ruleId: rule.id };
  const prefix = `${entity.id}-${rule.id}`;
  return h.div(
    [h.Class('rule'), h.Key(rule.id)],
    [
      h.div(
        [h.Class('property')],
        [
          h.label([h.For(`${prefix}-action`)], ['When clicked']),
          h.select(
            [
              h.Id(`${prefix}-action`),
              h.OnChange((kind) =>
                Message.ChangedRuleAction({
                  ...ids,
                  kind: isActionKind(kind) ? kind : rule.action._tag,
                }),
              ),
            ],
            actionKinds.map((kind) =>
              h.option(
                [h.Value(kind), h.Selected(kind === rule.action._tag)],
                [actionTitles[kind]],
              ),
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
              h.OnChange((target) => Message.ChangedRuleTarget({ ...ids, target })),
            ],
            [
              h.option([h.Value(SELF), h.Selected(rule.target === SELF)], ['Itself']),
              ...entities
                .filter((other) => other.id !== entity.id)
                .map((other) =>
                  h.option([h.Value(other.id), h.Selected(rule.target === other.id)], [other.name]),
                ),
            ],
          ),
        ],
      ),
      viewDetails(
        h,
        settingsOf(rule),
        rule.action,
        (key, value) => Message.ChangedRuleSetting({ ...ids, key, value }),
        prefix,
      ),
      h.button(
        [h.Type('button'), h.Class('remove'), h.OnClick(Message.ClickedRemoveRule(ids))],
        ['Remove rule'],
      ),
    ],
  );
};

/** The rules an entity follows while the document plays. */
export const viewBehaviour = (
  h: HtmlBuilder<Message>,
  entity: Entity,
  entities: ReadonlyArray<Entity>,
): Html =>
  h.section(
    [h.Class('behaviour')],
    [
      h.h2([], ['Behaviour']),
      ...(entity.rules.length === 0
        ? [h.p([h.Class('hint')], ['No rules yet. Add one to make this object react to clicks.'])]
        : entity.rules.map((rule) => viewRule(h, entity, entities, rule))),
      h.button(
        [h.Type('button'), h.OnClick(Message.ClickedAddRule({ entityId: entity.id }))],
        ['+ Add rule'],
      ),
    ],
  );
