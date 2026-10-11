import { describe, expect, it } from '@effect/vitest';
import { Option } from 'effect';
import { Story } from 'foldkit';
import { AskForCube, Message, type Model, initialModel, update } from '#src/main.ts';

describe('the playground', () => {
  it('starts joining the world, with nothing shown and no cubes counted', () => {
    expect(initialModel).toEqual({
      world: { _tag: 'Joining' },
      cubeCount: 0,
      maybeError: Option.none(),
    });
  });

  it('shows the world once it is joined and its canvas is in the page, and lets go of the canvas when the world is left', () => {
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

  it('asks the world for a cube when Spawn cube is clicked, and leaves the count to the world', () => {
    Story.story(
      update,
      Story.given({ ...initialModel, world: { _tag: 'Joined', canvas: 'Mounted' } }),
      Story.message(Message.ClickedSpawnCube()),
      Story.Command.expectExact(AskForCube),
      Story.Command.resolve(AskForCube, Message.AskedWorldForCube()),
      Story.model((model) => {
        expect(model.cubeCount).toBe(0);
      }),
      Story.message(Message.CountedCubes({ count: 1 })),
      Story.model((model) => {
        expect(model.cubeCount).toBe(1);
      }),
    );
  });

  it('says why the world could not be joined, shown, or asked', () => {
    const reasons = [
      Message.FailedJoinWorld({ reason: 'No worker.' }),
      Message.FailedShowWorld({ reason: 'No GPU.' }),
      Message.FailedAskWorldForCube({ reason: 'Not joined.' }),
    ].map((failed) => update(initialModel, failed).model.maybeError);

    expect(reasons).toEqual([
      Option.some('No worker.'),
      Option.some('No GPU.'),
      Option.some('Not joined.'),
    ]);
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

  it('takes a world found joined as joined only while it waits for one, and changes nothing once it has it', () => {
    Story.story(
      update,
      Story.given({ ...initialModel, maybeError: Option.some('Not joined.') }),
      Story.message(Message.FoundWorldJoined()),
      Story.model((model) => {
        expect(model.world).toEqual({ _tag: 'Joined', canvas: 'Waiting' });
        expect(model.maybeError).toEqual(Option.none());
      }),
    );
    // Found joined just after the world said so, and after the stage said why it could not show it.
    const shown: Model = {
      ...initialModel,
      world: { _tag: 'Joined', canvas: 'Mounted' },
      maybeError: Option.some('No GPU.'),
    };
    Story.story(
      update,
      Story.given(shown),
      Story.message(Message.FoundWorldJoined()),
      Story.model((model) => {
        expect(model).toEqual(shown);
      }),
    );
  });
});
