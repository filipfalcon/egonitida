import { describe, expect, it } from '@effect/vitest';
import { Devices } from '@lightocean/client';
import { Option } from 'effect';
import * as FigureControls from '#src/controls.ts';

/** A moment of the keyboard with `code` held. */
const key = (code: string): Devices.Reading => ({
  ...Devices.idle,
  keys: new Set([code]),
});

/** A moment of a pad with `button` pressed. */
const pad = (button: Devices.PadButton): Devices.Reading => ({
  ...Devices.idle,
  pads: [{ ...Devices.idlePad, buttons: { ...Devices.idlePad.buttons, [button]: 1 } }],
});

/** What the player did over `moments`, one after another, from the start. */
const playedOver = (...moments: ReadonlyArray<Devices.Reading>) =>
  moments.reduce((before, devices) => FigureControls.play(devices, before), FigureControls.start);

describe('the figure played', () => {
  it('chooses the next dial down the list, and the first again after the last', () => {
    const down = (count: number) =>
      Array.from({ length: count }, (_, at) => (at % 2 === 0 ? key('ArrowDown') : Devices.idle));

    expect(playedOver(...down(1)).chosen).toEqual('hips');
    expect(playedOver(...down(5)).chosen).toEqual('chest');
  });

  it('chooses the dial up the list by the pad, the last after the first', () => {
    expect(playedOver(pad('Up')).chosen).toEqual('legs');
  });

  it('turns the chosen dial toward more or toward less, once a press', () => {
    const toward = playedOver(key('ArrowDown'), Devices.idle, key('ArrowRight'));
    const held = FigureControls.play(key('ArrowRight'), toward);

    expect(toward.turned).toEqual(Option.some({ dial: 'hips', toward: 'More' }));
    expect(held.turned).toEqual(Option.none());
    expect(playedOver(pad('Left')).turned).toEqual(Option.some({ dial: 'chest', toward: 'Less' }));
  });
});
