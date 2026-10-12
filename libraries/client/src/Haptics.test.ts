import { describe, expect, it } from '@effect/vitest';
import { State } from '@lightocean/core';
import { Effect } from 'effect';
import * as Haptics from '#src/Haptics.ts';

/** A device that keeps what it is asked to make felt, in order. */
const recorded = () => {
  const felt: Array<Haptics.Motors | Haptics.Triggers> = [];
  const device: Haptics.Felt = {
    motors: (motors) =>
      Effect.sync(() => {
        felt.push(motors);
      }),
    triggers: (triggers) =>
      Effect.sync(() => {
        felt.push(triggers);
      }),
  };
  return { felt, device };
};

/** Two players' entities: the page's own, and someone else's. */
const players = () => {
  const [one, own] = State.spawn(State.empty({ seed: 1 }), []);
  const [, other] = State.spawn(one, []);
  return { own, other };
};

const resisting: Haptics.Triggers = {
  left: Haptics.free,
  right: { _tag: 'Resisting', from: 0.3, strength: 0.6 },
};

describe('rumbles mixed', () => {
  it('turn the motors as hard as the strongest of them, each fading as it goes, until it is over', () => {
    const kick = { strong: 1, weak: 0.2, seconds: 1 };
    const buzz = { strong: 0.3, weak: 0.8, seconds: 0.5 };

    const started = Haptics.mixed(Haptics.added([], kick), 0);
    const both = Haptics.mixed(Haptics.added(started.pulses, buzz), 0.25);
    const later = Haptics.mixed(both.pulses, 0.5);
    const over = Haptics.mixed(later.pulses, 0.5);

    expect(started.motors).toEqual({ strong: 1, weak: 0.2 });
    // A quarter of the way through the kick, and half of the buzz.
    expect(both.motors).toEqual({ strong: 0.75, weak: 0.4 });
    // The buzz over, the kick a quarter left.
    expect(later.motors).toEqual({ strong: 0.25, weak: 0.05 });
    expect(over).toEqual({ pulses: [], motors: Haptics.stillMotors });
  });
});

describe('haptics', () => {
  it.effect(
    "rumble every device of the page's own player as the frames go, and none for anyone else's",
    () =>
      Effect.gen(function* () {
        const { own, other } = players();
        const pad = recorded();
        const another = recorded();
        const haptics = Haptics.make({ player: own, felt: () => [pad.device, another.device] });

        yield* haptics.rumble(own, { strong: 1, weak: 0.5, seconds: 1 });
        yield* haptics.rumble(other, { strong: 0.5, weak: 0.5, seconds: 1 });
        yield* haptics.frame(0);
        yield* haptics.frame(0.5);
        yield* haptics.frame(0.6);

        expect(pad.felt).toEqual([
          { strong: 1, weak: 0.5 },
          { strong: 0.5, weak: 0.25 },
          Haptics.stillMotors,
        ]);
        expect(another.felt).toEqual(pad.felt);
      }),
  );

  it.effect('turn the motors only when they turn otherwise, and are silenced at once', () =>
    Effect.gen(function* () {
      const { own } = players();
      const pad = recorded();
      const haptics = Haptics.make({ player: own, felt: () => [pad.device] });

      yield* haptics.frame(0.1);
      yield* haptics.rumble(own, { strong: 1, weak: 1, seconds: 10 });
      yield* haptics.frame(0);
      yield* haptics.frame(0);
      yield* haptics.silence(own);
      yield* haptics.frame(0.1);

      expect(pad.felt).toEqual([{ strong: 1, weak: 1 }, Haptics.stillMotors]);
    }),
  );

  it.effect("set the triggers of the page's own player, and leave anyone else's alone", () =>
    Effect.gen(function* () {
      const { own, other } = players();
      const pad = recorded();
      const haptics = Haptics.make({ player: own, felt: () => [pad.device] });

      yield* haptics.triggers(own, resisting);
      yield* haptics.triggers(other, Haptics.freeTriggers);

      expect(pad.felt).toEqual([resisting]);
    }),
  );
});
