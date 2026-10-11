import { describe, expect, it } from '@effect/vitest';
import { Option } from 'effect';
import { Story } from 'foldkit';
import { Message, type Model, OpenPlay, SendEdit, initialModel, update } from '#src/main.ts';

/** The page with the document joined, and a box selected. */
const selecting: Model = {
  ...initialModel,
  isDocumentJoined: true,
  outline: [
    { entity: 1, name: 'Box 1', kind: 'Box', reacts: false },
    { entity: 2, name: 'Sphere 2', kind: 'Sphere', reacts: false },
  ],
  play: { _tag: 'Editing' },
  maybeSelected: Option.some({
    entity: 1,
    name: 'Box 1',
    shape: { kind: 'Box' },
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    colour: { hex: 0x4f8cff },
    spin: { speed: 0.5 },
    reactions: [],
  }),
};

/** That `message` sends the document `edit`, and changes nothing on the page until the document says what came of it. */
const sends = (message: Message, edit: Parameters<typeof SendEdit>[0]['edit']) =>
  Story.story(
    update,
    Story.given(selecting),
    Story.message(message),
    Story.Command.expectExact(SendEdit({ edit })),
    Story.Command.resolve(SendEdit, Message.SentEdit()),
    Story.model((model) => {
      expect(model).toEqual(selecting);
    }),
  );

describe('the editor', () => {
  it('starts joining its document, with nothing shown, outlined, or selected', () => {
    expect(initialModel).toEqual({
      isDocumentJoined: false,
      isCanvasMounted: false,
      outline: [],
      maybeSelected: Option.none(),
      play: { _tag: 'Editing' },
      isPlayJoined: false,
      maybeError: Option.none(),
    });
  });

  it('shows the document once it is joined and its canvas is in the page, and lets go of the canvas when it is left', () => {
    Story.story(
      update,
      Story.given(initialModel),
      Story.message(Message.JoinedDocument()),
      Story.message(Message.MountedCanvas()),
      Story.model((model) => {
        expect([model.isDocumentJoined, model.isCanvasMounted]).toEqual([true, true]);
      }),
      Story.message(Message.LeftDocument()),
      Story.model((model) => {
        expect([model.isDocumentJoined, model.isCanvasMounted]).toEqual([false, false]);
      }),
    );
  });

  it('keeps what the document says of its objects and of what the editor has selected', () => {
    const projected = [
      Message.ProjectedOutline({ objects: selecting.outline }),
      Message.ProjectedSelection({ maybeSelected: selecting.maybeSelected }),
    ].reduce((model, message) => update(model, message).model, {
      ...initialModel,
      isDocumentJoined: true,
    });

    expect(projected).toEqual(selecting);
  });

  it('sends the document each edit, as the editor makes it', () => {
    sends(Message.ClickedAddObject({ shape: 'Sphere' }), { _tag: 'AddedObject', shape: 'Sphere' });
    sends(Message.ClickedObject({ entity: 2 }), { _tag: 'Clicked', entity: 2 });
    sends(Message.ClickedDeleteSelected(), { _tag: 'RemovedObject', entity: 1 });
    sends(Message.ClickedDeselect(), { _tag: 'Deselected' });
    sends(Message.ChangedProperty({ component: 'Transform', field: 'scale', value: [2, 1, 1] }), {
      _tag: 'EditedProperty',
      entity: 1,
      component: 'Transform',
      field: 'scale',
      value: [2, 1, 1],
    });
    sends(Message.ClickedAddReaction(), { _tag: 'AddedReaction', entity: 1 });
    sends(Message.ChangedReactionTarget({ index: 0, target: '2' }), {
      _tag: 'ChangedReactionTarget',
      entity: 1,
      index: 0,
      target: { _tag: 'Other', entity: 2 },
    });
    sends(Message.ChangedReactionTarget({ index: 0, target: 'itself' }), {
      _tag: 'ChangedReactionTarget',
      entity: 1,
      index: 0,
      target: { _tag: 'Itself' },
    });
  });

  it('sends nothing for a value not yet typed whole, nor for an edit with nothing selected', () => {
    const noCommands = (model: Model, message: Message) =>
      Story.story(update, Story.given(model), Story.message(message), Story.Command.expectNone());

    noCommands(
      selecting,
      Message.ChangedProperty({
        component: 'Transform',
        field: 'scale',
        value: [Number.NaN, 1, 1],
      }),
    );
    noCommands(
      { ...selecting, maybeSelected: Option.none() },
      Message.ChangedProperty({ component: 'Colour', field: 'hex', value: 0 }),
    );
  });

  it('says why the document could not be joined, shown, or edited', () => {
    const reasons = [
      Message.FailedJoinDocument({ reason: 'No worker.' }),
      Message.FailedShowDocument({ reason: 'No GPU.' }),
      Message.FailedSendEdit({ reason: 'Not joined.' }),
    ].map((failed) => update(initialModel, failed).model.maybeError);

    expect(reasons).toEqual(['No worker.', 'No GPU.', 'Not joined.'].map(Option.some));
  });

  it('plays the document as it is when Play is pressed, and goes back to editing it at Stop', () => {
    Story.story(
      update,
      Story.given(selecting),
      Story.message(Message.ClickedPlay()),
      Story.Command.expectExact(OpenPlay),
      Story.Command.resolve(OpenPlay, Message.ReadDocumentForPlay({ opening: 'the document' })),
      Story.model((model) => {
        expect([model.play, model.isPlayJoined]).toEqual([
          { _tag: 'Playing', opening: 'the document' },
          false,
        ]);
      }),
      Story.message(Message.JoinedPlay()),
      Story.model((model) => {
        expect(model.isPlayJoined).toBe(true);
      }),
      Story.message(Message.ClickedStop()),
      Story.model((model) => {
        expect(model.play).toEqual({ _tag: 'Editing' });
      }),
      Story.message(Message.LeftPlay()),
      Story.model((model) => {
        expect(model.isPlayJoined).toBe(false);
      }),
    );
  });

  it('edits nothing while the document plays', () => {
    const playing: Model = { ...selecting, play: { _tag: 'Playing', opening: 'the document' } };
    for (const edit of [
      Message.ClickedAddObject({ shape: 'Box' }),
      Message.ClickedObject({ entity: 2 }),
      Message.ClickedDeleteSelected(),
      Message.ChangedProperty({ component: 'Colour', field: 'hex', value: 0 }),
      Message.ClickedAddReaction(),
    ]) {
      Story.story(update, Story.given(playing), Story.message(edit), Story.Command.expectNone());
    }
  });
});
