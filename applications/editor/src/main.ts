import { Inspector } from '@lightocean/reflection';
import { Option, Schema } from 'effect';
import type { Runtime, Update } from 'foldkit';
import { defineMessageUnion } from 'foldkit/message';
import { modifyFields } from 'foldkit/struct';
import {
  Document,
  Entity,
  type Rule,
  SELF,
  Shape,
  defaultAction,
  editAction,
  entityProperties,
  makeEntity,
} from '#src/document.ts';
import { WorldEvent, step } from '#src/play.ts';

// MODEL

/** One recorded event of a play session, with the world it led to. */
export const Entry = Schema.Struct({ event: WorldEvent, world: Document });
export type Entry = typeof Entry.Type;

/** The document running as a program: where it started, everything that has happened since, and which moment the debugger is showing. */
export const Session = Schema.Struct({
  initial: Document,
  entries: Schema.Array(Entry),
  /** `None` while following the live world; `Some(index)` while showing the world after that entry. */
  maybeInspectedIndex: Schema.Option(Schema.Int),
});
export type Session = typeof Session.Type;

export const Model = Schema.Struct({
  document: Document,
  maybeSelectedId: Schema.Option(Schema.String),
  nextEntityNumber: Schema.Int,
  nextRuleNumber: Schema.Int,
  maybeSession: Schema.Option(Session),
  isViewportMounted: Schema.Boolean,
  maybeViewportError: Schema.Option(Schema.String),
});
export type Model = typeof Model.Type;

const ActionKind = Schema.Literals(['SetColor', 'MoveBy', 'SetSpin']);

// MESSAGE

export const Message = defineMessageUnion({
  ClickedAddEntity: { shape: Shape },
  SelectedEntity: { id: Schema.String },
  ClickedNothing: {},
  ClickedDeleteSelected: {},
  /** A value typed into the Details panel, not yet checked against the property's schema. */
  ChangedProperty: { id: Schema.String, key: Schema.String, value: Schema.Unknown },
  ClickedAddRule: { entityId: Schema.String },
  ClickedRemoveRule: { entityId: Schema.String, ruleId: Schema.String },
  ChangedRuleTarget: { entityId: Schema.String, ruleId: Schema.String, target: Schema.String },
  ChangedRuleAction: { entityId: Schema.String, ruleId: Schema.String, kind: ActionKind },
  /** A value typed into a rule's settings, not yet checked against its action's schema. */
  ChangedRuleSetting: {
    entityId: Schema.String,
    ruleId: Schema.String,
    key: Schema.String,
    value: Schema.Unknown,
  },
  ClickedPlay: {},
  ClickedStop: {},
  ClickedInWorld: { id: Schema.String },
  InspectedEntry: { index: Schema.Int },
  ClickedLive: {},
  SucceededMountViewport: {},
  FailedMountViewport: { reason: Schema.String },
});
export type Message = typeof Message.Type;

// SESSION

const liveWorld = (session: Session): Document => session.entries.at(-1)?.world ?? session.initial;

/** The world the viewport shows while playing: the inspected moment, or else the live one. */
export const displayedWorld = (model: Model): Option.Option<Document> =>
  Option.map(model.maybeSession, (session) =>
    Option.match(session.maybeInspectedIndex, {
      onNone: () => liveWorld(session),
      onSome: (index) => session.entries[index]?.world ?? liveWorld(session),
    }),
  );

// UPDATE

const editableKeys = new Set(entityProperties.map((property) => property.key));

const editEntity = (entity: Entity, key: string, value: unknown): Entity =>
  editableKeys.has(key)
    ? Option.getOrElse(Inspector.edit(Entity, entity, key, value), () => entity)
    : entity;

const mapEntity = (model: Model, entityId: string, f: (entity: Entity) => Entity): Model =>
  modifyFields(model, {
    document: (document) => ({
      entities: document.entities.map((entity) => (entity.id === entityId ? f(entity) : entity)),
    }),
  });

const mapRule = (model: Model, entityId: string, ruleId: string, f: (rule: Rule) => Rule) =>
  mapEntity(model, entityId, (entity) => ({
    ...entity,
    rules: entity.rules.map((rule) => (rule.id === ruleId ? f(rule) : rule)),
  }));

const hasEntity = (model: Model, id: string) =>
  model.document.entities.some((entity) => entity.id === id);

const mapSession = (model: Model, f: (session: Session) => Session): Model =>
  modifyFields(model, { maybeSession: (maybeSession) => Option.map(maybeSession, f) });

/** Edits to the document only apply while it is not playing, the way Unreal locks the level during Play-in-Editor. */
const editing = (model: Model, edit: () => Model): Update.Return<Model, Message> => ({
  model: Option.isSome(model.maybeSession) ? model : edit(),
});

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    ClickedAddEntity: ({ shape }) =>
      editing(model, () => {
        const entity = makeEntity(shape, model.nextEntityNumber);
        return modifyFields(model, {
          document: (document) => ({ entities: [...document.entities, entity] }),
          maybeSelectedId: () => Option.some(entity.id),
          nextEntityNumber: (number) => number + 1,
        });
      }),
    SelectedEntity: ({ id }) =>
      editing(model, () =>
        hasEntity(model, id)
          ? modifyFields(model, { maybeSelectedId: () => Option.some(id) })
          : model,
      ),
    ClickedNothing: () => ({
      model: modifyFields(model, { maybeSelectedId: () => Option.none() }),
    }),
    ClickedDeleteSelected: () =>
      editing(model, () =>
        Option.match(model.maybeSelectedId, {
          onNone: () => model,
          onSome: (id) =>
            modifyFields(model, {
              document: (document) => ({
                entities: document.entities.filter((entity) => entity.id !== id),
              }),
              maybeSelectedId: () => Option.none(),
            }),
        }),
      ),
    ChangedProperty: ({ id, key, value }) =>
      editing(model, () => mapEntity(model, id, (entity) => editEntity(entity, key, value))),
    ClickedAddRule: ({ entityId }) =>
      editing(model, () =>
        modifyFields(
          mapEntity(model, entityId, (entity) => ({
            ...entity,
            rules: [
              ...entity.rules,
              {
                id: `rule-${model.nextRuleNumber}`,
                target: SELF,
                action: defaultAction('SetColor'),
              },
            ],
          })),
          { nextRuleNumber: (number) => number + 1 },
        ),
      ),
    ClickedRemoveRule: ({ entityId, ruleId }) =>
      editing(model, () =>
        mapEntity(model, entityId, (entity) => ({
          ...entity,
          rules: entity.rules.filter((rule) => rule.id !== ruleId),
        })),
      ),
    ChangedRuleTarget: ({ entityId, ruleId, target }) =>
      editing(model, () =>
        target === SELF || hasEntity(model, target)
          ? mapRule(model, entityId, ruleId, (rule) => ({ ...rule, target }))
          : model,
      ),
    ChangedRuleAction: ({ entityId, ruleId, kind }) =>
      editing(model, () =>
        mapRule(model, entityId, ruleId, (rule) => ({ ...rule, action: defaultAction(kind) })),
      ),
    ChangedRuleSetting: ({ entityId, ruleId, key, value }) =>
      editing(model, () =>
        mapRule(model, entityId, ruleId, (rule) => ({
          ...rule,
          action: editAction(rule.action, key, value),
        })),
      ),
    ClickedPlay: () =>
      editing(model, () =>
        modifyFields(model, {
          maybeSession: () =>
            Option.some({
              initial: model.document,
              entries: [],
              maybeInspectedIndex: Option.none(),
            }),
          maybeSelectedId: () => Option.none(),
        }),
      ),
    ClickedStop: () => ({
      model: modifyFields(model, { maybeSession: () => Option.none() }),
    }),
    ClickedInWorld: ({ id }) => ({
      model: mapSession(model, (session) => {
        // While the debugger shows the past, the world is paused: a click there changes nothing.
        if (Option.isSome(session.maybeInspectedIndex)) {
          return session;
        }
        const event: WorldEvent = { _tag: 'ClickedEntity', id };
        return {
          ...session,
          entries: [...session.entries, { event, world: step(liveWorld(session), event) }],
        };
      }),
    }),
    InspectedEntry: ({ index }) => ({
      model: mapSession(model, (session) =>
        index >= 0 && index < session.entries.length
          ? { ...session, maybeInspectedIndex: Option.some(index) }
          : session,
      ),
    }),
    ClickedLive: () => ({
      model: mapSession(model, (session) => ({ ...session, maybeInspectedIndex: Option.none() })),
    }),
    SucceededMountViewport: () => ({
      model: modifyFields(model, { isViewportMounted: () => true }),
    }),
    FailedMountViewport: ({ reason }) => ({
      model: modifyFields(model, { maybeViewportError: () => Option.some(reason) }),
    }),
  });

// INIT

export const initialModel: Model = {
  document: { entities: [makeEntity('Box', 1), makeEntity('Sphere', 2)] },
  maybeSelectedId: Option.none(),
  nextEntityNumber: 3,
  nextRuleNumber: 1,
  maybeSession: Option.none(),
  isViewportMounted: false,
  maybeViewportError: Option.none(),
};

export const init: Runtime.ApplicationInit<Model, Message> = () => ({ model: initialModel });
