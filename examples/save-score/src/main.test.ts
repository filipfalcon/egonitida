import { describe, expect, it } from '@effect/vitest';
import { Option } from 'effect';
import { Story } from 'foldkit';
import { Message, PlayAgain, initialModel, update } from '#src/main.ts';

describe('the page', () => {
  it('starts joining the round, with nothing shown and nothing told of it', () => {
    expect(initialModel).toEqual({
      world: { _tag: 'Joining' },
      maybeRound: Option.none(),
      maybeError: Option.none(),
    });
  });

  it('shows the round once it is joined and its canvas is in the page, and lets go of the canvas when it is left', () => {
    Story.story(
      update,
      Story.given(initialModel),
      Story.message(Message.JoinedWorld()),
      Story.message(Message.MountedCanvas()),
      Story.model((model) => {
        expect(model.world).toEqual({ _tag: 'Joined', canvas: 'Mounted' });
      }),
      Story.message(Message.LeftWorld()),
      Story.model((model) => {
        expect(model.world).toEqual({ _tag: 'Joining' });
      }),
    );
  });

  it('keeps how the round goes as the world tells it', () => {
    const told = update(
      initialModel,
      Message.ToldRound({
        maybeRound: Option.some({ _tag: 'Playing', hits: 2, secondsLeft: 7 }),
      }),
    ).model;

    expect(told.maybeRound).toEqual(Option.some({ _tag: 'Playing', hits: 2, secondsLeft: 7 }));
  });

  it('asks the world for a new round when Play again is clicked, and leaves the round to the world', () => {
    const over = update(
      { ...initialModel, world: { _tag: 'Joined', canvas: 'Mounted' } },
      Message.ToldRound({ maybeRound: Option.some({ _tag: 'Saved', hits: 3, best: 7 }) }),
    ).model;

    Story.story(
      update,
      Story.given(over),
      Story.message(Message.ClickedPlayAgain()),
      Story.Command.expectExact(PlayAgain),
      Story.Command.resolve(PlayAgain, Message.ChoseNewRound()),
      Story.model((model) => {
        expect(model).toEqual(over);
      }),
    );
  });

  it('says why the round could not be joined, shown, or played again', () => {
    const reasons = [
      Message.FailedJoinWorld({ reason: 'No worker.' }),
      Message.FailedShowWorld({ reason: 'No GPU.' }),
      Message.FailedChooseNewRound({ reason: 'Not joined.' }),
    ].map((failed) => update(initialModel, failed).model.maybeError);

    expect(reasons).toEqual(['No worker.', 'No GPU.', 'Not joined.'].map(Option.some));
  });

  it('shows it again after a reload, whichever comes first of the world joined and the stage finding it is not', () => {
    // A Model restored after a reload says the world is joined and its canvas in the page, before it is joined again.
    const restored = {
      ...initialModel,
      world: { _tag: 'Joined', canvas: 'Mounted' },
      maybeError: Option.some('The world is not joined.'),
    } as const;

    Story.story(
      update,
      Story.given(restored),
      Story.message(Message.JoinedWorld()),
      Story.model((model) => {
        expect(model.world).toEqual({ _tag: 'Joined', canvas: 'Mounted' });
        // What went wrong while it was not joined is past.
        expect(model.maybeError).toEqual(Option.none());
      }),
    );
    Story.story(
      update,
      Story.given(restored),
      Story.message(Message.LeftWorld()),
      Story.message(Message.JoinedWorld()),
      Story.message(Message.MountedCanvas()),
      Story.model((model) => {
        expect(model.world).toEqual({ _tag: 'Joined', canvas: 'Mounted' });
      }),
    );
  });
});
