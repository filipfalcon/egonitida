import { describe, expect, it } from '@effect/vitest';
import { State } from '@lightocean/core';
import { Effect } from 'effect';
import * as Lighting from '#src/Lighting.ts';

/** A device whose lights keep the colours they are lit, in order. */
const recorded = () => {
  const lit: Array<Lighting.Colour> = [];
  const players: Array<number> = [];
  const device: Lighting.Lit = {
    colour: (colour) =>
      Effect.sync(() => {
        lit.push(colour);
      }),
    players: (count) =>
      Effect.sync(() => {
        players.push(count);
      }),
  };
  return { lit, players, device };
};

describe('lighting', () => {
  it.effect("lights every device of the page's own player, and none for anyone else's", () =>
    Effect.gen(function* () {
      const [one, own] = State.spawn(State.empty({ seed: 1 }), []);
      const [, other] = State.spawn(one, []);
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
      const [, own] = State.spawn(State.empty({ seed: 1 }), []);
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

  it.effect(
    "lights as many of the player lights of the page's own player's devices as asked, again too",
    () =>
      Effect.gen(function* () {
        const [one, own] = State.spawn(State.empty({ seed: 1 }), []);
        const [, other] = State.spawn(one, []);
        const pad = recorded();
        const devices = { lit: [pad.device] };
        const lighting = Lighting.make({ player: own, lit: () => devices.lit });

        yield* lighting.players(own, 3);
        yield* lighting.players(other, 5);
        const later = recorded();
        devices.lit.push(later.device);
        yield* lighting.again;

        expect(pad.players).toEqual([3, 3]);
        expect(later.players).toEqual([3]);
      }),
  );

  it.effect(
    'lights them only when asked for another colour, or as many player lights otherwise',
    () =>
      Effect.gen(function* () {
        const [, own] = State.spawn(State.empty({ seed: 1 }), []);
        const pad = recorded();
        const lighting = Lighting.make({ player: own, lit: () => [pad.device] });
        const red = { red: 1, green: 0, blue: 0 };
        const blue = { red: 0, green: 0, blue: 1 };

        yield* lighting.colour(own, red);
        yield* lighting.colour(own, { ...red });
        yield* lighting.colour(own, blue);
        yield* lighting.players(own, 2);
        yield* lighting.players(own, 2);

        expect(pad.lit).toEqual([red, blue]);
        expect(pad.players).toEqual([2]);
      }),
  );
});
