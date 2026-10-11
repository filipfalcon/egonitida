import { describe, expect, it } from '@effect/vitest';
import { Option } from 'effect';
import { Story } from 'foldkit';
import { AskForCube, Message, initialModel, update } from '#src/main.ts';

describe('the playground', () => {
  it('starts joining the world, with nothing shown and no cubes counted', () => {
    expect(initialModel).toEqual({
      isWorldJoined: false,
      isCanvasMounted: false,
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
        expect([model.isWorldJoined, model.isCanvasMounted]).toEqual([true, true]);
      }),
      Story.message(Message.LeftWorld()),
      Story.model((model) => {
        expect([model.isWorldJoined, model.isCanvasMounted]).toEqual([false, false]);
      }),
    );
  });

  it('asks the world for a cube when Spawn cube is clicked, and leaves the count to the world', () => {
    Story.story(
      update,
      Story.given({ ...initialModel, isWorldJoined: true }),
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
});
