import { describe, expect, it } from '@effect/vitest';
import { Option } from 'effect';
import { Story } from 'foldkit';
import { Message, type Model, initialModel, update } from '#src/main.ts';

describe('the website', () => {
  it('starts joining the ocean, with nothing shown', () => {
    expect(initialModel).toEqual({ ocean: { _tag: 'Joining' }, maybeError: Option.none() });
  });

  it('shows the ocean once it is joined and its canvas is in the page, and lets go of the canvas when the ocean is left', () => {
    Story.story(
      update,
      Story.given(initialModel),
      Story.message(Message.JoinedOcean()),
      Story.message(Message.MountedCanvas()),
      Story.model((model) => {
        expect(model.ocean).toEqual({ _tag: 'Joined', canvas: 'Mounted' });
      }),
      Story.message(Message.LeftOcean()),
      Story.model((model) => {
        expect(model.ocean).toEqual({ _tag: 'Joining' });
      }),
    );
  });

  it('says why the ocean could not be joined or shown', () => {
    const reasons = [
      Message.FailedJoinOcean({ reason: 'No worker.' }),
      Message.FailedShowOcean({ reason: 'No GPU.' }),
    ].map((failed) => update(initialModel, failed).model.maybeError);

    expect(reasons).toEqual([Option.some('No worker.'), Option.some('No GPU.')]);
  });

  it('shows it again after a reload, whichever comes first of the ocean joined and the stage finding it is not', () => {
    // A Model restored after a reload says the ocean is joined and its canvas in the page, before it is joined again.
    const restored: Model = {
      ocean: { _tag: 'Joined', canvas: 'Mounted' },
      maybeError: Option.some('The ocean is not joined.'),
    };

    Story.story(
      update,
      Story.given(restored),
      Story.message(Message.JoinedOcean()),
      Story.model((model) => {
        expect(model.ocean).toEqual({ _tag: 'Joined', canvas: 'Mounted' });
        // What went wrong while it was not joined is past.
        expect(model.maybeError).toEqual(Option.none());
      }),
    );
    Story.story(
      update,
      Story.given(restored),
      Story.message(Message.LeftOcean()),
      Story.message(Message.JoinedOcean()),
      Story.message(Message.MountedCanvas()),
      Story.model((model) => {
        expect(model.ocean).toEqual({ _tag: 'Joined', canvas: 'Mounted' });
      }),
    );
  });

  it('takes an ocean found joined as joined only while it waits for one, and changes nothing once it has it', () => {
    Story.story(
      update,
      Story.given({ ...initialModel, maybeError: Option.some('Not joined.') }),
      Story.message(Message.FoundOceanJoined()),
      Story.model((model) => {
        expect(model.ocean).toEqual({ _tag: 'Joined', canvas: 'Waiting' });
        expect(model.maybeError).toEqual(Option.none());
      }),
    );
    const shown: Model = {
      ocean: { _tag: 'Joined', canvas: 'Mounted' },
      maybeError: Option.some('No GPU.'),
    };
    Story.story(
      update,
      Story.given(shown),
      Story.message(Message.FoundOceanJoined()),
      Story.model((model) => {
        expect(model).toEqual(shown);
      }),
    );
  });
});
