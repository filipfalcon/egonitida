import { describe, expect, it } from '@effect/vitest';
import { Option } from 'effect';
import { SELF, defaultAction } from '#src/document.ts';
import { Message, type Model, displayedWorld, initialModel, update } from '#src/main.ts';

const after = (messages: ReadonlyArray<Message>, model: Model = initialModel): Model =>
  messages.reduce((current, message) => update(current, message).model, model);

const entityIds = (model: Model) => model.document.entities.map((entity) => entity.id);

describe('editor', () => {
  it('starts with a box and a sphere, and nothing selected', () => {
    expect(initialModel.document.entities.map((entity) => entity.shape)).toEqual(['Box', 'Sphere']);
    expect(initialModel.maybeSelectedId).toEqual(Option.none());
  });

  describe('adding', () => {
    it('adds a named entity of the chosen shape, and selects it', () => {
      const model = after([Message.ClickedAddEntity({ shape: 'Sphere' })]);
      const added = model.document.entities.at(-1);

      expect(added?.shape).toBe('Sphere');
      expect(added?.name).toBe('Sphere 3');
      expect(model.maybeSelectedId).toEqual(Option.some(added?.id));
    });

    it('gives every added entity an id and a place of its own', () => {
      const model = after(
        Array.from({ length: 6 }, () => Message.ClickedAddEntity({ shape: 'Box' })),
      );
      const positions = model.document.entities.map((entity) => entity.position.join(','));

      expect(new Set(entityIds(model)).size).toBe(8);
      expect(new Set(positions).size).toBe(8);
    });
  });

  describe('selecting', () => {
    const [first] = entityIds(initialModel);

    it('selects an entity by id', () => {
      const model = after([Message.SelectedEntity({ id: first ?? '' })]);

      expect(model.maybeSelectedId).toEqual(Option.some(first));
    });

    it('ignores an id no entity has', () => {
      const model = after([Message.SelectedEntity({ id: 'missing' })]);

      expect(model.maybeSelectedId).toEqual(Option.none());
    });

    it('clears the selection on a click that hits nothing', () => {
      const model = after([Message.SelectedEntity({ id: first ?? '' }), Message.ClickedNothing()]);

      expect(model.maybeSelectedId).toEqual(Option.none());
    });
  });

  describe('deleting', () => {
    it('deletes the selected entity and clears the selection', () => {
      const [first, second] = entityIds(initialModel);
      const model = after([
        Message.SelectedEntity({ id: first ?? '' }),
        Message.ClickedDeleteSelected(),
      ]);

      expect(entityIds(model)).toEqual([second]);
      expect(model.maybeSelectedId).toEqual(Option.none());
    });

    it('deletes nothing while nothing is selected', () => {
      expect(after([Message.ClickedDeleteSelected()]).document).toEqual(initialModel.document);
    });
  });

  describe('editing', () => {
    const [first, second] = entityIds(initialModel);

    it('changes a property of one entity, leaving the others', () => {
      const model = after([
        Message.ChangedProperty({ id: first ?? '', key: 'name', value: 'Crate' }),
        Message.ChangedProperty({ id: first ?? '', key: 'position', value: [4, 5, 6] }),
      ]);
      const [edited, untouched] = model.document.entities;

      expect(edited?.name).toBe('Crate');
      expect(edited?.position).toEqual([4, 5, 6]);
      expect(untouched).toEqual(initialModel.document.entities[1]);
      expect(untouched?.id).toBe(second);
    });

    it('ignores a value the property’s schema rejects', () => {
      const model = after([
        Message.ChangedProperty({ id: first ?? '', key: 'spinSpeed', value: Number.NaN }),
        Message.ChangedProperty({ id: first ?? '', key: 'shape', value: 'Cone' }),
      ]);

      expect(model.document).toEqual(initialModel.document);
    });

    it('ignores a field the Details panel does not expose', () => {
      const model = after([
        Message.ChangedProperty({ id: first ?? '', key: 'id', value: 'stolen' }),
      ]);

      expect(model.document).toEqual(initialModel.document);
    });
  });

  describe('viewport', () => {
    it('records that the viewport mounted', () => {
      expect(after([Message.SucceededMountViewport()]).isViewportMounted).toBe(true);
    });

    it('records why the viewport failed to mount', () => {
      const model = after([Message.FailedMountViewport({ reason: 'No GPU.' })]);

      expect(model.maybeViewportError).toEqual(Option.some('No GPU.'));
    });
  });

  describe('behaviour', () => {
    const [first, second] = entityIds(initialModel);
    const entityId = first ?? '';
    const rulesOf = (model: Model) =>
      model.document.entities.find((entity) => entity.id === entityId)?.rules ?? [];
    const withRule = after([Message.ClickedAddRule({ entityId })]);
    const ruleId = rulesOf(withRule)[0]?.id ?? '';

    it('adds a rule that sets the entity’s own colour', () => {
      expect(rulesOf(withRule)).toEqual([
        { id: ruleId, target: SELF, action: defaultAction('SetColor') },
      ]);
    });

    it('gives every rule an id of its own', () => {
      const model = after([Message.ClickedAddRule({ entityId })], withRule);
      const [one, two] = rulesOf(model);

      expect(one?.id).not.toBe(two?.id);
    });

    it('removes a rule', () => {
      const model = after([Message.ClickedRemoveRule({ entityId, ruleId })], withRule);

      expect(rulesOf(model)).toEqual([]);
    });

    it('retargets a rule at another entity, or back at itself', () => {
      const retargeted = after(
        [Message.ChangedRuleTarget({ entityId, ruleId, target: second ?? '' })],
        withRule,
      );
      const back = after(
        [Message.ChangedRuleTarget({ entityId, ruleId, target: SELF })],
        retargeted,
      );

      expect(rulesOf(retargeted)[0]?.target).toBe(second);
      expect(rulesOf(back)[0]?.target).toBe(SELF);
    });

    it('ignores a target no entity has', () => {
      const model = after(
        [Message.ChangedRuleTarget({ entityId, ruleId, target: 'missing' })],
        withRule,
      );

      expect(rulesOf(model)[0]?.target).toBe(SELF);
    });

    it('switches a rule to another action, with that action’s defaults', () => {
      const model = after(
        [Message.ChangedRuleAction({ entityId, ruleId, kind: 'MoveBy' })],
        withRule,
      );

      expect(rulesOf(model)[0]?.action).toEqual(defaultAction('MoveBy'));
    });

    it('changes a setting of the rule’s action, through that action’s schema', () => {
      const moving = after(
        [Message.ChangedRuleAction({ entityId, ruleId, kind: 'MoveBy' })],
        withRule,
      );
      const model = after(
        [
          Message.ChangedRuleSetting({ entityId, ruleId, key: 'offset', value: [2, 0, 0] }),
          Message.ChangedRuleSetting({ entityId, ruleId, key: 'offset', value: [1, 2] }),
          Message.ChangedRuleSetting({ entityId, ruleId, key: '_tag', value: 'SetSpin' }),
        ],
        moving,
      );

      expect(rulesOf(model)[0]?.action).toEqual({ _tag: 'MoveBy', offset: [2, 0, 0] });
    });
  });

  describe('playing', () => {
    const [first] = entityIds(initialModel);
    const entityId = first ?? '';
    // The box turns green when clicked.
    const authored = after([
      Message.ClickedAddRule({ entityId }),
      Message.SelectedEntity({ id: entityId }),
    ]);
    const playing = after([Message.ClickedPlay()], authored);
    const colorIn = (model: Model) =>
      Option.map(displayedWorld(model), (world) => world.entities[0]?.color);

    it('plays the document as it stands, with nothing selected', () => {
      expect(Option.map(playing.maybeSession, (session) => session.initial)).toEqual(
        Option.some(authored.document),
      );
      expect(playing.maybeSelectedId).toEqual(Option.none());
    });

    it('steps the running world on a click, and records it', () => {
      const model = after([Message.ClickedInWorld({ id: entityId })], playing);
      const entries = Option.map(model.maybeSession, (session) => session.entries.length);

      expect(colorIn(model)).toEqual(Option.some(0xffffff));
      expect(entries).toEqual(Option.some(1));
      expect(model.document).toEqual(authored.document);
    });

    it('records a click that changed nothing too', () => {
      const [, second] = entityIds(initialModel);
      const model = after([Message.ClickedInWorld({ id: second ?? '' })], playing);

      expect(Option.map(model.maybeSession, (session) => session.entries.length)).toEqual(
        Option.some(1),
      );
    });

    it('shows the world as it was at an inspected entry, ignoring clicks meanwhile', () => {
      const moved = after(
        [
          Message.ChangedRuleAction({ entityId, ruleId: 'rule-1', kind: 'MoveBy' }),
          Message.ClickedPlay(),
          Message.ClickedInWorld({ id: entityId }),
          Message.ClickedInWorld({ id: entityId }),
          Message.InspectedEntry({ index: 0 }),
          Message.ClickedInWorld({ id: entityId }),
        ],
        authored,
      );
      const heightIn = (model: Model) =>
        Option.map(displayedWorld(model), (world) => world.entities[0]?.position[1]);

      expect(heightIn(moved)).toEqual(Option.some(1));
      expect(heightIn(after([Message.ClickedLive()], moved))).toEqual(Option.some(2));
    });

    it('ignores an entry that does not exist', () => {
      const model = after([Message.InspectedEntry({ index: 3 })], playing);

      expect(Option.flatMap(model.maybeSession, (session) => session.maybeInspectedIndex)).toEqual(
        Option.none(),
      );
    });

    it('leaves the document alone while playing', () => {
      const model = after([Message.ClickedAddEntity({ shape: 'Box' })], playing);

      expect(model.document).toEqual(authored.document);
    });

    it('stops, keeping the document as it was before playing', () => {
      const model = after(
        [Message.ClickedInWorld({ id: entityId }), Message.ClickedStop()],
        playing,
      );

      expect(model.maybeSession).toEqual(Option.none());
      expect(model.document).toEqual(authored.document);
    });

    it('shows no running world while editing', () => {
      expect(displayedWorld(authored)).toEqual(Option.none());
    });
  });
});
