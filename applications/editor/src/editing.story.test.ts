import { describe, expect, it } from '@effect/vitest';
import { Pointing, Story, State } from '@lightocean/core';
import { Option } from 'effect';
import * as Editing from '#src/editing.ts';
import * as Objects from '#src/objects.ts';

/** The starting document, with an editor in it, and its two objects named. */
const given = Story.given(Editing.joined.state, {
  editor: Editing.joined.editor,
  box: Editing.box,
  sphere: Editing.sphere,
});

/** Every object in `state`, by its label, in the order they were made. */
const labels = (state: State.State) =>
  State.holding(state, [Objects.Shape]).map((object) =>
    Option.map(State.get(state, object, Pointing.Label), ({ text }) => text),
  );

const edit = (entity: State.Entity, component: string, field: string, value: unknown) =>
  Story.act('editor', Editing.EditedProperty, { entity, component, field, value });

describe('editing a document', () => {
  it('adds an object in the next place, numbered on from the last, and selects it for whoever added it', () => {
    const told = Story.story(
      Editing.game,
      given,
      Story.act('editor', Editing.AddedObject, { shape: 'Sphere' }),
      Story.step(),
    );

    expect(labels(told.state)).toEqual(['Box 1', 'Sphere 2', 'Sphere 3'].map(Option.some));
    const added = State.holding(told.state, [Objects.Shape]).at(-1);
    expect(Story.valueOf(told, 'editor', Editing.Selection)).toEqual({
      selected: Option.fromNullishOr(added),
    });
    expect(
      Option.flatMap(Option.fromNullishOr(added), (object) =>
        State.get(told.state, object, Objects.Transform),
      ),
    ).toEqual(Option.some({ position: Objects.placeOf(2), rotation: [0, 0, 0], scale: [1, 1, 1] }));
  });

  it("changes a property only when its component's schema takes the value", () => {
    Story.story(
      Editing.game,
      given,
      edit(Editing.box, 'Transform', 'position', [1, 2, 3]),
      edit(Editing.box, 'Transform', 'scale', 'big'),
      edit(Editing.box, 'Colour', 'hex', 0x00ff00),
      edit(Editing.box, 'Shape', 'kind', 'Cone'),
      edit(Editing.box, 'Gravity', 'pull', 1),
      Story.step(),
      Story.expect('box', Objects.Transform, ({ position, scale }) => {
        expect([position, scale]).toEqual([
          [1, 2, 3],
          [1, 1, 1],
        ]);
      }),
      Story.expectEqual('box', Objects.Colour, { hex: 0x00ff00 }),
      Story.expectEqual('box', Objects.Shape, { kind: 'Box' }),
    );
  });

  it('renames an object, which it is read out as from then on', () => {
    Story.story(
      Editing.game,
      given,
      edit(Editing.box, 'Label', 'text', 'Crate'),
      Story.step(),
      Story.expectEqual('box', Pointing.Label, { text: 'Crate' }),
    );
  });

  it('selects an object clicked, and nothing once the editor lets go', () => {
    Story.story(
      Editing.game,
      given,
      Story.act('editor', Pointing.Clicked, { entity: Editing.sphere }),
      Story.step(),
      Story.expectEqual('editor', Editing.Selection, { selected: Option.some(Editing.sphere) }),
      Story.act('editor', Editing.Deselected, {}),
      Story.step(),
      Story.expectEqual('editor', Editing.Selection, { selected: Option.none() }),
    );
  });

  it('removes an object, and lets go of it wherever it was selected', () => {
    const told = Story.story(
      Editing.game,
      given,
      Story.act('editor', Pointing.Clicked, { entity: Editing.box }),
      Story.step(),
      Story.act('editor', Editing.RemovedObject, { entity: Editing.box }),
      Story.step(),
      Story.expectEqual('editor', Editing.Selection, { selected: Option.none() }),
    );

    expect(labels(told.state)).toEqual([Option.some('Sphere 2')]);
  });
});

describe('editing what an object does when clicked', () => {
  const reactionsOf = (told: Story.Simulation) =>
    Story.valueOf(told, 'box', Objects.Behaviour).reactions;

  it('adds a reaction that recolours the object itself, and removes it again', () => {
    const added = Story.story(
      Editing.game,
      given,
      Story.act('editor', Editing.AddedReaction, { entity: Editing.box }),
      Story.step(),
    );
    const removed = Story.story(
      Editing.game,
      Story.given(added.state, { editor: Editing.joined.editor, box: Editing.box }),
      Story.act('editor', Editing.RemovedReaction, { entity: Editing.box, index: 0 }),
      Story.step(),
    );

    expect(reactionsOf(added)).toEqual([
      { target: { _tag: 'Itself' }, change: { _tag: 'Recolour', hex: 0xffffff } },
    ]);
    expect(reactionsOf(removed)).toEqual([]);
  });

  it('changes what a reaction does, whom it does it to, and its settings, as their schemas take them', () => {
    const told = Story.story(
      Editing.game,
      given,
      Story.act('editor', Editing.AddedReaction, { entity: Editing.box }),
      Story.step(),
      Story.act('editor', Editing.ChangedReactionKind, {
        entity: Editing.box,
        index: 0,
        kind: 'MoveBy',
      }),
      Story.act('editor', Editing.ChangedReactionTarget, {
        entity: Editing.box,
        index: 0,
        target: { _tag: 'Other', entity: Editing.sphere },
      }),
      Story.step(),
      Story.act('editor', Editing.ChangedReactionSetting, {
        entity: Editing.box,
        index: 0,
        field: 'offset',
        value: [0, 2, 0],
      }),
      Story.act('editor', Editing.ChangedReactionSetting, {
        entity: Editing.box,
        index: 0,
        field: 'offset',
        value: 'up',
      }),
      Story.act('editor', Editing.ChangedReactionTarget, {
        entity: Editing.box,
        index: 0,
        target: { _tag: 'Other', entity: Editing.joined.editor },
      }),
      Story.step(),
    );

    expect(reactionsOf(told)).toEqual([
      {
        target: { _tag: 'Other', entity: Editing.sphere },
        change: { _tag: 'MoveBy', offset: [0, 2, 0] },
      },
    ]);
  });
});
