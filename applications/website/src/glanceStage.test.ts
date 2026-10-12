import { describe, expect, it } from '@effect/vitest';
import { Option } from 'effect';
import { Story } from 'foldkit';
import {
  ChooseBeat,
  SuspendTime,
  Message,
  type Model,
  ResumeTime,
  initialModel,
  isWaiting,
  conceptsOf,
  lineOf,
  phrasesOf,
  update,
} from '#src/glanceStage.ts';

const shown: Model = {
  stage: { _tag: 'Joined', mounted: ['Stage'] },
  maybeMoment: Option.none(),
  maybeTick: Option.none(),
  time: 'Running',
};

describe('the stage at a glance', () => {
  it('opens joining its game, with nothing shown and nothing told', () => {
    expect(initialModel).toEqual({
      stage: { _tag: 'Joining' },
      maybeMoment: Option.none(),
      maybeTick: Option.none(),
      time: 'Running',
    });
    expect(lineOf(initialModel)).toEqual(Option.none());
  });

  it('shows its game once it is joined and its canvas is in the page, and lets go of the canvas when the game is left', () => {
    Story.story(
      update,
      Story.given(initialModel),
      Story.message(Message.JoinedGame()),
      Story.model((model) => {
        expect(model.stage).toEqual({ _tag: 'Joined', mounted: [] });
      }),
      Story.message(Message.MountedCanvas({ pane: 'Stage' })),
      Story.model((model) => {
        expect(model.stage).toEqual({ _tag: 'Joined', mounted: ['Stage'] });
      }),
      Story.message(Message.LeftGame()),
      Story.model((model) => {
        expect(model.stage).toEqual({ _tag: 'Joining' });
      }),
    );
  });

  it('keeps the canvas it has when joined again, as a Model restored after a reload is', () => {
    Story.story(
      update,
      Story.given(shown),
      Story.message(Message.JoinedGame()),
      Story.model((model) => {
        expect(model.stage).toEqual({ _tag: 'Joined', mounted: ['Stage'] });
      }),
    );
  });

  it('tells how the game begins, line by line, as far as the game has come', () => {
    Story.story(
      update,
      Story.given(shown),
      Story.message(Message.ProjectedTelling({ moment: 'Waiting', maybeTick: Option.none() })),
      Story.model((model) => {
        expect(lineOf(model)).toEqual(Option.some('At first there is nothing.'));
        expect(isWaiting(model)).toBe(true);
      }),
      Story.message(Message.ProjectedTelling({ moment: 'Nothing', maybeTick: Option.none() })),
      Story.model((model) => {
        expect(lineOf(model)).toEqual(Option.some('At first there is nothing.'));
        expect(isWaiting(model)).toBe(false);
      }),
      Story.message(Message.ProjectedTelling({ moment: 'Ideas', maybeTick: Option.none() })),
      Story.model((model) => {
        expect(lineOf(model)).toEqual(Option.some('Then the ideas start coming.'));
      }),
      Story.message(Message.ProjectedTelling({ moment: 'State', maybeTick: Option.none() })),
      Story.model((model) => {
        expect(lineOf(model)).toEqual(Option.some('Finally, a state emerges.'));
      }),
    );
  });

  it('says why its game could not be joined or shown', () => {
    expect(
      update(initialModel, Message.FailedJoinGame({ reason: 'No worker.' })).model.stage,
    ).toEqual({ _tag: 'Failed', reason: 'No worker.' });
    expect(update(shown, Message.FailedShowState({ reason: 'No GPU.' })).model.stage).toEqual({
      _tag: 'Failed',
      reason: 'No GPU.',
    });
  });

  it('stops the game’s time and starts it again', () => {
    Story.story(
      update,
      Story.given(shown),
      Story.message(Message.PressedStop()),
      Story.Command.expectExact(SuspendTime),
      Story.Command.resolve(SuspendTime, Message.ControlledGame()),
      Story.model((model) => {
        expect(model.time).toBe('Suspended');
      }),
      Story.message(Message.PressedStart()),
      Story.Command.expectExact(ResumeTime),
      Story.Command.resolve(ResumeTime, Message.ControlledGame()),
      Story.model((model) => {
        expect(model.time).toBe('Running');
      }),
    );
  });

  it('chooses the beat before or after as the viewer, stepping the game once to take the choice in while its time is stopped', () => {
    Story.story(
      update,
      Story.given(shown),
      Story.message(Message.PressedNext()),
      Story.Command.expectExact(ChooseBeat({ choice: 'Next', isSuspended: false })),
      Story.Command.resolve(ChooseBeat, Message.ControlledGame()),
      Story.message(Message.PressedStop()),
      Story.Command.expectExact(SuspendTime),
      Story.Command.resolve(SuspendTime, Message.ControlledGame()),
      Story.message(Message.PressedBack()),
      Story.Command.expectExact(ChooseBeat({ choice: 'Back', isSuspended: true })),
      Story.Command.resolve(ChooseBeat, Message.ControlledGame()),
    );
  });

  it('controls nothing before its game is joined', () => {
    Story.story(
      update,
      Story.given(initialModel),
      Story.message(Message.PressedNext()),
      Story.message(Message.PressedStop()),
      Story.model((model) => {
        expect(model).toEqual(initialModel);
      }),
    );
  });

  it('starts the telling as the viewer when play is pressed while it waits', () => {
    Story.story(
      update,
      Story.given({ ...shown, maybeMoment: Option.some('Waiting') }),
      Story.message(Message.PressedPlay()),
      Story.Command.expectExact(ChooseBeat({ choice: 'Start', isSuspended: false })),
      Story.Command.resolve(ChooseBeat, Message.ControlledGame()),
    );
  });

  it('tells every line large, a phrase to a line, the first the same before and after it starts', () => {
    expect(phrasesOf('Waiting')).toEqual(['At first', 'there is', 'nothing.']);
    expect(phrasesOf('Nothing')).toEqual(['At first', 'there is', 'nothing.']);
    expect(phrasesOf('Ideas')).toEqual(['Then the ideas', 'start coming.']);
    expect(phrasesOf('State')).toEqual(['Finally,', 'a state', 'emerges.']);
  });

  it('tells the beats after the state emerges large too, in the order each term needs the one before', () => {
    expect(phrasesOf('Entities')).toEqual(['Entities', 'emerge.']);
    expect(phrasesOf('Components')).toEqual(['Components', 'give them form.']);
    expect(phrasesOf('Step')).toEqual(['Time starts', 'stepping.']);
  });

  it('sets down each term in the table as the telling introduces it, and none before', () => {
    const terms = (moment: Parameters<typeof conceptsOf>[0]) =>
      conceptsOf(moment).map(({ term }) => term);

    expect(terms('Waiting')).toEqual([]);
    expect(terms('Ideas')).toEqual([]);
    expect(terms('State')).toEqual(['State']);
    expect(terms('Entities')).toEqual(['State', 'Entity']);
    expect(terms('Components')).toEqual(['State', 'Entity', 'Component']);
    expect(terms('Step')).toEqual(['State', 'Entity', 'Component', 'Step', 'Tick']);
  });

  it('counts the state’s ticks while the telling counts them', () => {
    Story.story(
      update,
      Story.given(shown),
      Story.message(Message.ProjectedTelling({ moment: 'Step', maybeTick: Option.some(41) })),
      Story.model((model) => {
        expect(model.maybeTick).toEqual(Option.some(41));
      }),
      Story.message(Message.ProjectedTelling({ moment: 'State', maybeTick: Option.none() })),
      Story.model((model) => {
        expect(model.maybeTick).toEqual(Option.none());
      }),
    );
  });

  it('shows each pane once its own canvas is in the page, and lets go of them all when the game is left', () => {
    Story.story(
      update,
      Story.given(shown),
      Story.message(Message.MountedCanvas({ pane: 'State' })),
      Story.message(Message.MountedCanvas({ pane: 'Entity' })),
      Story.message(Message.MountedCanvas({ pane: 'State' })),
      Story.model((model) => {
        expect(model.stage).toEqual({ _tag: 'Joined', mounted: ['Stage', 'State', 'Entity'] });
      }),
      Story.message(Message.LeftGame()),
      Story.model((model) => {
        expect(model.stage).toEqual({ _tag: 'Joining' });
      }),
    );
  });
});
