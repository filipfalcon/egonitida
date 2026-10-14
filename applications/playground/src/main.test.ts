import { describe, expect, it } from '@effect/vitest';
import { Option } from 'effect';
import { Story } from 'foldkit';
import { AskForCube, Message, type Model, initialModel, update } from '#src/main.ts';

describe('the playground', () => {
  it('starts joining the game, with nothing shown and no cubes counted', () => {
    expect(initialModel).toEqual({
      session: { _tag: 'Joining' },
      cubeCount: 0,
      viewpoint: 'Ahead',
      maybeError: Option.none(),
    });
  });

  it('keeps where the player looks from, as the page does, and asks nothing of the game for it', () => {
    Story.story(
      update,
      Story.given({ ...initialModel, session: { _tag: 'Joined', canvas: 'Mounted' } }),
      Story.message(Message.ChoseViewpoint({ viewpoint: 'Overhead' })),
      Story.Command.expectNone(),
      Story.model((model) => {
        expect(model.viewpoint).toBe('Overhead');
      }),
    );
  });

  it('shows the game once it is joined and its canvas is in the page, and lets go of the canvas when the game is left', () => {
    Story.story(
      update,
      Story.given(initialModel),
      Story.message(Message.JoinedGame()),
      Story.message(Message.MountedCanvas()),
      Story.model((model) => {
        expect(model.session).toEqual({ _tag: 'Joined', canvas: 'Mounted' });
      }),
      Story.message(Message.LeftGame()),
      Story.model((model) => {
        expect(model.session).toEqual({ _tag: 'Joining' });
      }),
    );
  });

  it('asks the game for a cube when Spawn cube is clicked, and leaves the count to the game', () => {
    Story.story(
      update,
      Story.given({ ...initialModel, session: { _tag: 'Joined', canvas: 'Mounted' } }),
      Story.message(Message.ClickedSpawnCube()),
      Story.Command.expectExact(AskForCube),
      Story.Command.resolve(AskForCube, Message.AskedGameForCube()),
      Story.model((model) => {
        expect(model.cubeCount).toBe(0);
      }),
      Story.message(Message.CountedCubes({ count: 1 })),
      Story.model((model) => {
        expect(model.cubeCount).toBe(1);
      }),
    );
  });

  it('says why the game could not be joined, shown, or asked', () => {
    const reasons = [
      Message.FailedJoinGame({ reason: 'No worker.' }),
      Message.FailedShowGame({ reason: 'No GPU.' }),
      Message.FailedAskGameForCube({ reason: 'Not joined.' }),
    ].map((failed) => update(initialModel, failed).model.maybeError);

    expect(reasons).toEqual([
      Option.some('No worker.'),
      Option.some('No GPU.'),
      Option.some('Not joined.'),
    ]);
  });

  it('shows it again after a reload, whichever comes first of the session joined and the stage finding it is not', () => {
    // A Model restored after a reload says the session is joined and its canvas in the page, before it is joined again.
    const restored = {
      ...initialModel,
      session: { _tag: 'Joined', canvas: 'Mounted' },
      maybeError: Option.some('The session is not joined.'),
    } as const;

    Story.story(
      update,
      Story.given(restored),
      Story.message(Message.JoinedGame()),
      Story.model((model) => {
        expect(model.session).toEqual({ _tag: 'Joined', canvas: 'Mounted' });
        // What went wrong while it was not joined is past.
        expect(model.maybeError).toEqual(Option.none());
      }),
    );
    Story.story(
      update,
      Story.given(restored),
      Story.message(Message.LeftGame()),
      Story.message(Message.JoinedGame()),
      Story.message(Message.MountedCanvas()),
      Story.model((model) => {
        expect(model.session).toEqual({ _tag: 'Joined', canvas: 'Mounted' });
      }),
    );
  });

  it('takes a session found joined as joined only while it waits for one, and changes nothing once it has it', () => {
    Story.story(
      update,
      Story.given({ ...initialModel, maybeError: Option.some('Not joined.') }),
      Story.message(Message.FoundGameJoined()),
      Story.model((model) => {
        expect(model.session).toEqual({ _tag: 'Joined', canvas: 'Waiting' });
        expect(model.maybeError).toEqual(Option.none());
      }),
    );
    // Found joined just after the session said so, and after the stage said why it could not show it.
    const shown: Model = {
      ...initialModel,
      session: { _tag: 'Joined', canvas: 'Mounted' },
      maybeError: Option.some('No GPU.'),
    };
    Story.story(
      update,
      Story.given(shown),
      Story.message(Message.FoundGameJoined()),
      Story.model((model) => {
        expect(model).toEqual(shown);
      }),
    );
  });
});
