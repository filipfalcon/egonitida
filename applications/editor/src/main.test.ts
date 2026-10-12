import { describe, expect, it } from '@effect/vitest';
import { Option } from 'effect';
import { Story } from 'foldkit';
import {
  GoLive,
  Message,
  type Model,
  OpenPlay,
  type Past,
  type PlayingState,
  SendEdit,
  ShowPast,
  initialModel,
  update,
} from '#src/main.ts';

/** The page with the document joined, and a box selected. */
const selecting: Model = {
  ...initialModel,
  document: { _tag: 'Joined', canvas: 'Mounted' },
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
      document: { _tag: 'Joining' },
      outline: [],
      maybeSelected: Option.none(),
      play: { _tag: 'Editing' },
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
        expect(model.document).toEqual({ _tag: 'Joined', canvas: 'Mounted' });
      }),
      Story.message(Message.LeftDocument()),
      Story.model((model) => {
        expect(model.document).toEqual({ _tag: 'Joining' });
      }),
    );
  });

  it('keeps what the document says of its objects and of what the editor has selected', () => {
    const projected = [
      Message.ProjectedOutline({ objects: selecting.outline }),
      Message.ProjectedSelection({ maybeSelected: selecting.maybeSelected }),
    ].reduce((model: Model, message) => update(model, message).model, {
      ...initialModel,
      document: { _tag: 'Joined', canvas: 'Mounted' },
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
        expect(model.play).toEqual({
          _tag: 'Playing',
          opening: 'the document',
          session: 'Opening',
          steps: [],
          maybePast: Option.none(),
        });
      }),
      Story.message(Message.JoinedPlay()),
      Story.model((model) => {
        expect(model.play).toMatchObject({ _tag: 'Playing', session: 'Joined' });
      }),
      Story.message(Message.ClickedStop()),
      Story.model((model) => {
        expect(model.play).toEqual({ _tag: 'Editing' });
      }),
      Story.message(Message.LeftPlay()),
      Story.model((model) => {
        expect(model.play).toEqual({ _tag: 'Editing' });
      }),
    );
  });

  /** The page with the document playing, its session joined, with `steps` told and `maybePast` shown. */
  const playingWith = (
    steps: PlayingState['steps'] = [],
    maybePast: Option.Option<typeof Past.Type> = Option.none(),
  ): Model => ({
    ...selecting,
    play: { _tag: 'Playing', opening: 'the document', session: 'Joined', steps, maybePast },
  });

  it('plays again after a reload, whichever comes first of the game playing joined and the stage finding it is not', () => {
    // A Model restored after a reload says the game playing is joined, before it is joined again.
    const restored: Model = {
      ...playingWith(),
      maybeError: Option.some('The session Played is not joined.'),
    };

    for (const messages of [[Message.JoinedPlay()], [Message.LeftPlay(), Message.JoinedPlay()]]) {
      Story.story(
        update,
        Story.given(restored),
        ...messages.map((message) => Story.message(message)),
        Story.model((model) => {
          expect(model.play).toMatchObject({ _tag: 'Playing', session: 'Joined' });
          // What went wrong while it was not joined is past.
          expect(model.maybeError).toEqual(Option.none());
        }),
      );
    }
  });

  it('edits nothing while the document plays', () => {
    const playing = playingWith();
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

  describe('the debugger', () => {
    /** A click on the box, as the debugger tells it. */
    const clicked = {
      tick: 40,
      actions: [{ tag: 'Clicked', fields: '{"entity":1,"player":3}' }],
      parts: [{ part: 'Objects: on Moved', set: { Transform: [2] }, spawned: [], despawned: [] }],
    };

    it('keeps the steps the document playing tells of', () => {
      const told = update(playingWith(), Message.ToldSteps({ steps: [clicked] })).model;

      expect(told.play).toMatchObject({ steps: [clicked] });
    });

    it('shows the state after a step, the canvas too, and the live game again', () => {
      Story.story(
        update,
        Story.given(playingWith([clicked])),
        Story.message(Message.InspectedStep({ tick: 40 })),
        Story.Command.expectExact(ShowPast({ tick: 40 })),
        Story.Command.resolve(ShowPast, Message.ShowedPast({ tick: 40, state: '{"1":{}}' })),
        Story.model((model) => {
          expect(model.play).toMatchObject({
            maybePast: Option.some({ tick: 40, state: '{"1":{}}' }),
          });
        }),
        Story.message(Message.ClickedLive()),
        Story.Command.expectExact(GoLive),
        Story.Command.resolve(GoLive, Message.WentLive()),
        Story.model((model) => {
          expect(model.play).toMatchObject({ maybePast: Option.none() });
        }),
      );
    });

    it('forgets what it was told once playing stops', () => {
      const stopped = update(
        playingWith([clicked], Option.some({ tick: 40, state: '{}' })),
        Message.ClickedStop(),
      ).model;

      expect(stopped.play).toEqual({ _tag: 'Editing' });
    });
  });

  it('shows it again after a reload, whichever comes first of the session joined and the stage finding it is not', () => {
    // A Model restored after a reload says the document is joined and its canvas in the page, before it is joined again.
    const restored = {
      ...initialModel,
      document: { _tag: 'Joined', canvas: 'Mounted' },
      maybeError: Option.some('The session is not joined.'),
    } as const;

    Story.story(
      update,
      Story.given(restored),
      Story.message(Message.JoinedDocument()),
      Story.model((model) => {
        expect(model.document).toEqual({ _tag: 'Joined', canvas: 'Mounted' });
        // What went wrong while it was not joined is past.
        expect(model.maybeError).toEqual(Option.none());
      }),
    );
    Story.story(
      update,
      Story.given(restored),
      Story.message(Message.LeftDocument()),
      Story.message(Message.JoinedDocument()),
      Story.message(Message.MountedCanvas()),
      Story.model((model) => {
        expect(model.document).toEqual({ _tag: 'Joined', canvas: 'Mounted' });
      }),
    );
  });

  it('takes the document or the game playing found joined as joined only while it waits for one', () => {
    Story.story(
      update,
      Story.given({ ...initialModel, maybeError: Option.some('Not joined.') }),
      Story.message(Message.FoundDocumentJoined()),
      Story.model((model) => {
        expect(model.document).toEqual({ _tag: 'Joined', canvas: 'Waiting' });
        expect(model.maybeError).toEqual(Option.none());
      }),
    );
    const opening: Model = {
      ...selecting,
      play: {
        _tag: 'Playing',
        opening: 'the document',
        session: 'Opening',
        steps: [],
        maybePast: Option.none(),
      },
    };
    Story.story(
      update,
      Story.given(opening),
      Story.message(Message.FoundPlayJoined()),
      Story.model((model) => {
        expect(model.play).toMatchObject({ session: 'Joined' });
      }),
    );
    // Found joined just after it said so, and after the stage said why it could not show it.
    for (const [shown, found] of [
      [{ ...selecting, maybeError: Option.some('No GPU.') }, Message.FoundDocumentJoined()],
      [{ ...playingWith(), maybeError: Option.some('No GPU.') }, Message.FoundPlayJoined()],
    ] as const) {
      Story.story(
        update,
        Story.given(shown),
        Story.message(found),
        Story.model((model) => {
          expect(model).toEqual(shown);
        }),
      );
    }
  });
});
