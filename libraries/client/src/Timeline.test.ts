import { describe, expect, it } from '@effect/vitest';
import { Component, State } from '@nitida/core';
import { Option, Schema } from 'effect';
import * as Timeline from '#src/Timeline.ts';

const Position = Component.make('Position', Schema.Struct({ x: Schema.Finite }), {
  owner: 'simulation',
  network: 'predicted',
});

const STEP = 1 / 60;

/** The state at `tick`, holding one entity whose position is the tick itself, so drawn positions read as times. */
const stateAt = (tick: number): State.State => {
  const [state] = State.spawn(State.empty({ seed: 1 }), [Position.of({ x: tick })]);
  return { ...state, tick };
};

const receiveAll = (timeline: Timeline.Timeline, ticks: ReadonlyArray<number>) =>
  ticks.reduce((current, tick) => Timeline.receive(current, stateAt(tick)), timeline);

const start = Timeline.make({ stepRate: 60, keepSeconds: 2 });

/** The position of the entity as the timeline would draw it now. */
const drawn = (timeline: Timeline.Timeline) =>
  Option.flatMap(Timeline.view(timeline), (view) => view.get(0, Position)).pipe(
    Option.map((position) => position.x),
  );

describe('Timeline', () => {
  it('has nothing to draw before a state arrives', () => {
    expect(Timeline.view(start)).toEqual(Option.none());
  });

  it('draws the first state as soon as it arrives', () => {
    expect(drawn(Timeline.receive(start, stateAt(1)))).toEqual(Option.some(1));
  });

  it('draws between the two newest states, a step behind the newest', () => {
    const timeline = Timeline.elapse(receiveAll(start, [1, 2]), STEP / 2);

    expect(Option.getOrElse(drawn(timeline), () => 0)).toBeCloseTo(1.5);
  });

  it('keeps a step behind the newest while states arrive every step', () => {
    const timeline = [3, 4, 5, 6, 7, 8].reduce(
      (current, tick) => Timeline.elapse(Timeline.receive(current, stateAt(tick)), STEP),
      receiveAll(start, [1, 2]),
    );

    // The newest state is tick 8, so drawing sits at tick 7.
    expect(Option.getOrElse(drawn(timeline), () => 0)).toBeCloseTo(7);
  });

  it('never runs past the newest state, however long none arrives', () => {
    const timeline = Timeline.elapse(receiveAll(start, [1, 2]), 5);

    expect(drawn(timeline)).toEqual(Option.some(2));
  });

  it('does not jump when states arrive late and together, but moves on at nearly real time', () => {
    const steady = Timeline.elapse(receiveAll(start, [1, 2]), STEP);
    // Two steps' worth of time passes with nothing new, then both states arrive at once.
    const late = Timeline.elapse(receiveAll(steady, [3, 4]), STEP);
    const before = Option.getOrElse(drawn(steady), () => 0);
    const after = Option.getOrElse(drawn(late), () => 0);

    // One step of real time moves drawing by at most a step and two percent.
    expect(after - before).toBeGreaterThan(0);
    expect(after - before).toBeLessThanOrEqual(1.02 + 1e-9);
  });

  it('catches up at once when it is far behind, as when it first joins', () => {
    const ticks = Array.from({ length: 60 }, (_, index) => index + 1);
    const timeline = Timeline.elapse(receiveAll(start, ticks), STEP / 10);

    expect(Option.getOrElse(drawn(timeline), () => 0)).toBeCloseTo(59, 0);
  });

  it('draws an older state at once when one arrives, as when the host goes back in time', () => {
    const steady = Timeline.elapse(receiveAll(start, [10, 11, 12]), STEP);

    const back = Timeline.receive(steady, stateAt(5));

    expect(drawn(back)).toEqual(Option.some(5));
    expect(back.history.map(({ tick }) => tick)).toEqual([5]);
  });

  it('shows an entity from the moment the state it appears in is reached', () => {
    const [withOther] = State.spawn(stateAt(2), [Position.of({ x: 100 })]);
    const timeline = Timeline.elapse(
      Timeline.receive(Timeline.receive(start, stateAt(1)), withOther),
      STEP / 2,
    );
    const other = Option.flatMap(Timeline.view(timeline), (view) => view.get(1, Position));

    expect(other).toEqual(Option.none());
  });

  it('keeps an entity until the state it is gone from is reached', () => {
    const gone = State.despawn(stateAt(2), 0);
    const timeline = Timeline.elapse(
      Timeline.receive(Timeline.receive(start, stateAt(1)), gone),
      STEP / 2,
    );

    expect(Option.isSome(drawn(timeline))).toBe(true);
  });

  describe('querying what is drawn', () => {
    /** Ticks 1 and 2, the second with another entity at x = 100, drawn halfway between them. */
    const halfway = (() => {
      const [withOther] = State.spawn(stateAt(2), [Position.of({ x: 100 })]);
      return Timeline.elapse(
        Timeline.receive(Timeline.receive(start, stateAt(1)), withOther),
        STEP / 2,
      );
    })();
    const rows = (timeline: Timeline.Timeline) =>
      Option.map(Timeline.view(timeline), (view) => view.query(Position));

    it('gives every entity drawn, each where it is between the two states, as `get` has it', () => {
      const between = Option.getOrThrow(drawn(halfway));

      expect(between).toBeGreaterThan(1);
      expect(between).toBeLessThan(2);
      expect(rows(halfway)).toEqual(Option.some([[0, { x: between }]]));
    });

    it('gives an entity from the moment the state it appears in is reached', () => {
      const reached = Timeline.elapse(halfway, STEP);

      expect(rows(reached)).toEqual(
        Option.some([
          [0, { x: 2 }],
          [1, { x: 100 }],
        ]),
      );
      expect(Option.map(Timeline.view(reached), (view) => view.entities)).toEqual(
        Option.some([0, 1]),
      );
    });

    it('gives an entity until the state it is gone from is reached', () => {
      const gone = State.despawn(stateAt(2), 0);
      const between = Timeline.elapse(
        Timeline.receive(Timeline.receive(start, stateAt(1)), gone),
        STEP / 2,
      );

      expect(rows(between)).toEqual(Option.some([[0, { x: 1 }]]));
      expect(rows(Timeline.elapse(between, STEP))).toEqual(Option.some([]));
    });
  });

  describe('presentations', () => {
    const recorded = Timeline.elapse(
      receiveAll(
        start,
        Array.from({ length: 60 }, (_, index) => index + 1),
      ),
      STEP,
    );

    it('plays a past moment at its own pace', () => {
      const slowed = Timeline.elapse(
        Timeline.present(recorded, { from: 20 * STEP, rate: 0.25 }),
        4 * STEP,
      );

      // Four steps of real time at a quarter of the pace: one step of the past.
      expect(Option.getOrElse(drawn(slowed), () => 0)).toBeCloseTo(21);
    });

    it('is not moved by states that arrive meanwhile', () => {
      const frozen = Timeline.present(recorded, { from: 20 * STEP, rate: 0 });
      const meanwhile = Timeline.elapse(receiveAll(frozen, [61, 62, 63]), STEP);

      expect(Option.getOrElse(drawn(meanwhile), () => 0)).toBeCloseTo(20);
    });

    it('returns to the live state when it ends', () => {
      const presented = Timeline.elapse(
        Timeline.present(recorded, { from: 20 * STEP, rate: 0 }),
        STEP,
      );
      const back = Timeline.elapse(Timeline.live(receiveAll(presented, [61])), STEP / 10);

      expect(Option.getOrElse(drawn(back), () => 0)).toBeCloseTo(60, 0);
    });

    it('starts no earlier than the oldest state kept', () => {
      const short = Timeline.make({ stepRate: 60, keepSeconds: 0.5 });
      const kept = receiveAll(
        short,
        Array.from({ length: 60 }, (_, index) => index + 1),
      );
      const earliest = Timeline.present(kept, { from: 0, rate: 0 });

      // Half a second at 60 Hz is thirty steps, so tick 30 is the oldest kept.
      expect(Option.getOrElse(drawn(earliest), () => 0)).toBeCloseTo(30, 0);
    });
  });
});
