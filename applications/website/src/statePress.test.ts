import { describe, expect, it } from '@effect/vitest';
import { Story as Stories, State } from '@lightocean/core';
import { Option } from 'effect';
import { Story } from 'foldkit';
import * as Press from '#src/press.ts';
import {
  Message,
  type Model,
  GoBack,
  ShowState,
  StepGame,
  type Stamp,
  initialModel,
  readoutOf,
  update,
  stampOf,
} from '#src/statePress.ts';

/** A state the press is shown at `tick`, holding what the press's game starts with. */
const stateAt = (tick: number): Stamp => ({ ...stampOf(Press.state), tick, random: tick * 1000 });

/** Long enough for the press to finish a step, and the frames to get there one by one. */
const frames = (count: number) =>
  Array.from({ length: count }, () => Story.message(Message.ElapsedFrame({ milliseconds: 50 })));

/** The figure joined to its game, asking to see it, and shown the state at `tick`. */
const joinedAt = (tick: number) => [
  Story.message(Message.JoinedGame()),
  Story.Command.expectExact(ShowState),
  Story.Command.resolve(ShowState, Message.ShowedState()),
  Story.message(Message.ProjectedState({ state: stateAt(tick) })),
];

/** A click on the press: it asks the game for a step, and the game takes it. */
const clicked = [
  Story.message(Message.RequestedStep()),
  Story.Command.expectExact(StepGame),
  Story.Command.resolve(StepGame, Message.SteppedGame()),
];

const ticksOf = (model: Model) => model.states.map(({ tick }) => tick);

describe('the state press', () => {
  it('reads off a state of the engine what its globes show: what each thing is, where on the globe it stands, how far it goes a step, and its health', () => {
    expect(stampOf(Press.state)).toEqual({
      tick: 0,
      random: Press.state.random,
      things: [
        {
          kind: 'Tree',
          longitude: 20,
          latitude: 40,
          maybeStride: Option.none(),
          maybeHealth: Option.none(),
        },
        {
          kind: 'Volcano',
          longitude: 105,
          latitude: 30,
          maybeStride: Option.none(),
          maybeHealth: Option.none(),
        },
        {
          kind: 'Dragon',
          longitude: 330,
          latitude: 50,
          maybeStride: Option.some(30),
          maybeHealth: Option.some(14),
        },
        {
          kind: 'Warrior',
          longitude: 60,
          latitude: 35,
          maybeStride: Option.some(12),
          maybeHealth: Option.some(14),
        },
      ],
    });
  });

  it('reads the next state off the engine once it has stepped', () => {
    const stepped = Stories.story(Press.game, Stories.given(Press.state, {}), Stories.step());

    expect(stampOf(stepped.state).tick).toBe(1);
    expect(stampOf(stepped.state).things[3]?.longitude).toBe(
      Option.getOrThrow(State.get(stepped.state, Press.warrior, Press.Position)).longitude,
    );
  });

  it('waits for its game, and puts the first state it is shown under the press', () => {
    expect(readoutOf(initialModel)).toBe('joining the game');
    Story.story(
      update,
      Story.given(initialModel),
      ...joinedAt(7),
      Story.model((model) => {
        expect(ticksOf(model)).toEqual([7]);
        expect(readoutOf(model)).toBe('state at tick 7 · 4 entities · 12 components');
      }),
    );
  });

  it('asks the game for a step on a click, and stamps the state it is shown next, the earlier ones sliding back unchanged', () => {
    Story.story(
      update,
      Story.given(initialModel),
      ...joinedAt(0),
      ...clicked,
      Story.message(Message.ProjectedState({ state: stateAt(1) })),
      Story.model((model) => {
        expect(model.press._tag).toBe('Stepping');
      }),
      ...frames(40),
      Story.model((model) => {
        expect(model.press).toEqual({ _tag: 'Resting' });
        expect(ticksOf(model)).toEqual([0, 1]);
        expect(model.states[0]).toEqual(stateAt(0));
      }),
    );
  });

  it('keeps the last five states it was shown, stamping each in turn', () => {
    Story.story(
      update,
      Story.given(initialModel),
      ...joinedAt(0),
      ...[1, 2, 3, 4, 5, 6].map((tick) =>
        Story.message(Message.ProjectedState({ state: stateAt(tick) })),
      ),
      ...frames(240),
      Story.model((model) => {
        expect(ticksOf(model)).toEqual([2, 3, 4, 5, 6]);
        expect(model.press).toEqual({ _tag: 'Resting' });
      }),
    );
  });

  it('takes a state told again at the same tick in place of the one it had, as the host’s own state replaces the empty one a page starts with', () => {
    const told: Stamp = { ...stateAt(0), things: stateAt(0).things.slice(0, 1) };
    Story.story(
      update,
      Story.given(initialModel),
      ...joinedAt(0),
      Story.message(Message.ProjectedState({ state: told })),
      Story.model((model) => {
        expect(model.states).toEqual([told]);
      }),
    );
  });

  it('passes over the empty state a page holds before its host has sent it one', () => {
    Story.story(
      update,
      Story.given(initialModel),
      ...joinedAt(0),
      Story.message(Message.ProjectedState({ state: { tick: 0, random: 0, things: [] } })),
      Story.model((model) => {
        expect(model.states).toEqual([stateAt(0)]);
      }),
    );
  });

  it('asks its game to go back to an earlier state chosen on the rail, and keeps the rail up to it once the game has', () => {
    Story.story(
      update,
      Story.given(initialModel),
      ...joinedAt(0),
      ...[1, 2, 3].map((tick) => Story.message(Message.ProjectedState({ state: stateAt(tick) }))),
      ...frames(120),
      Story.message(Message.ChoseState({ index: 1 })),
      Story.Command.expectExact(GoBack({ tick: 1 })),
      Story.Command.resolve(GoBack, Message.WentBack()),
      Story.message(Message.ProjectedState({ state: stateAt(1) })),
      Story.model((model) => {
        expect(ticksOf(model)).toEqual([0, 1]);
        expect(model.press).toEqual({ _tag: 'Resting' });
        expect(readoutOf(model)).toBe('state at tick 1 · 4 entities · 12 components');
      }),
    );
  });

  it('goes back to nothing from the newest state, or while the press is stamping', () => {
    Story.story(
      update,
      Story.given(initialModel),
      ...joinedAt(0),
      Story.message(Message.ProjectedState({ state: stateAt(1) })),
      Story.message(Message.ChoseState({ index: 0 })),
      ...frames(40),
      Story.message(Message.ChoseState({ index: 1 })),
      Story.model((model) => {
        expect(ticksOf(model)).toEqual([0, 1]);
      }),
    );
  });

  it('starts its rail over from a state the host went back to', () => {
    Story.story(
      update,
      Story.given(initialModel),
      ...joinedAt(4),
      Story.message(Message.ProjectedState({ state: stateAt(2) })),
      Story.model((model) => {
        expect(ticksOf(model)).toEqual([2]);
      }),
    );
  });

  it('asks for nothing before its game is joined', () => {
    Story.story(
      update,
      Story.given(initialModel),
      Story.message(Message.RequestedStep()),
      Story.model((model) => {
        expect(model).toEqual(initialModel);
      }),
    );
  });

  it('reads an earlier state back while it is pointed at, and the newest again once it is left', () => {
    Story.story(
      update,
      Story.given(initialModel),
      ...joinedAt(0),
      Story.message(Message.ProjectedState({ state: stateAt(1) })),
      ...frames(40),
      Story.message(Message.PointedAtState({ index: 0 })),
      Story.model((model) => {
        expect(readoutOf(model)).toBe('state at tick 0 · kept as it was');
      }),
      Story.message(Message.LeftStates()),
      Story.model((model) => {
        expect(readoutOf(model)).toBe('state at tick 1 · 4 entities · 12 components');
      }),
    );
  });

  it('lands each state at once for a reader who asked for less motion', () => {
    Story.story(
      update,
      Story.given(initialModel),
      Story.message(Message.ChangedMotionPreference({ isReduced: true })),
      ...joinedAt(0),
      Story.message(Message.ProjectedState({ state: stateAt(1) })),
      Story.model((model) => {
        expect(model.press).toEqual({ _tag: 'Resting' });
        expect(ticksOf(model)).toEqual([0, 1]);
      }),
    );
  });
});
