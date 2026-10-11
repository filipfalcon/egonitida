import { describe, expect, it } from '@effect/vitest';
import { World } from '@lightocean/core';
import { Effect } from 'effect';
import * as Lighting from '#src/Lighting.ts';

/** A device whose lights keep the colours they are lit, in order. */
const recorded = () => {
  const lit: Array<Lighting.Colour> = [];
  const device: Lighting.Lit = {
    colour: (colour) =>
      Effect.sync(() => {
        lit.push(colour);
      }),
  };
  return { lit, device };
};

describe('lighting', () => {
  it.effect("lights every device of the page's own player, and none for anyone else's", () =>
    Effect.gen(function* () {
      const [one, own] = World.spawn(World.empty({ seed: 1 }), []);
      const [, other] = World.spawn(one, []);
      const pad = recorded();
      const keyboard = recorded();
      const lighting = Lighting.make({ player: own, lit: () => [pad.device, keyboard.device] });
      const green = { red: 0, green: 1, blue: 0 };

      yield* lighting.colour(own, green);
      yield* lighting.colour(other, { red: 1, green: 0, blue: 0 });

      expect(pad.lit).toEqual([green]);
      expect(keyboard.lit).toEqual([green]);
    }),
  );

  it.effect('lights a device connected since as the rest were last lit, once asked to again', () =>
    Effect.gen(function* () {
      const [, own] = World.spawn(World.empty({ seed: 1 }), []);
      const pad = recorded();
      const devices = { lit: new Array<Lighting.Lit>() };
      const lighting = Lighting.make({ player: own, lit: () => devices.lit });
      const red = { red: 1, green: 0, blue: 0 };

      yield* lighting.again;
      yield* lighting.colour(own, red);
      devices.lit.push(pad.device);
      yield* lighting.again;

      expect(pad.lit).toEqual([red]);
    }),
  );
});
