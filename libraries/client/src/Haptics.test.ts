import { describe, expect, it } from '@effect/vitest';
import { World } from '@lightocean/core';
import { Effect } from 'effect';
import * as Haptics from '#src/Haptics.ts';

/** A device that keeps what it is asked to make felt, in order. */
const recorded = () => {
  const felt: Array<Haptics.Rumble | Haptics.Triggers> = [];
  const device: Haptics.Felt = {
    rumble: (rumble) =>
      Effect.sync(() => {
        felt.push(rumble);
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
  const [one, own] = World.spawn(World.empty({ seed: 1 }), []);
  const [, other] = World.spawn(one, []);
  return { own, other };
};

const resisting: Haptics.Triggers = {
  left: Haptics.free,
  right: { _tag: 'Resisting', from: 0.3, strength: 0.6 },
};

describe('haptics', () => {
  it.effect("rumble every device of the page's own player, and none for anyone else's", () =>
    Effect.gen(function* () {
      const { own, other } = players();
      const pad = recorded();
      const another = recorded();
      const haptics = Haptics.make({ player: own, felt: () => [pad.device, another.device] });
      const bite = { strong: 1, weak: 0.4, seconds: 0.2 };

      yield* haptics.rumble(own, bite);
      yield* haptics.rumble(other, { strong: 0.5, weak: 0.5, seconds: 1 });

      expect(pad.felt).toEqual([bite]);
      expect(another.felt).toEqual([bite]);
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
