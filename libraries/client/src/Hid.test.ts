import { describe, expect, it } from '@effect/vitest';
import { Effect, Exit, Option, Scope } from 'effect';
import * as DualSense from '#src/DualSense.ts';
import * as Hid from '#src/Hid.ts';

/** A DualSense as WebHID gives one, which sends the reports a test hands it. */
class Recorded extends EventTarget {
  readonly vendorId = 0x054c;
  readonly productId = 0x0ce6;
  opened = false;
  async open() {
    this.opened = true;
  }
  async close() {
    this.opened = false;
  }
  send(reportId: number, bytes: ReadonlyArray<number>) {
    const data = new DataView(new Uint8Array(bytes).buffer);
    this.dispatchEvent(Object.assign(new Event('inputreport'), { reportId, data }));
  }
}

/** A report over USB with Cross pressed and the sticks at rest. */
const crossPressed = [
  128,
  128,
  128,
  128,
  0,
  0,
  0,
  0x20 | 0x08,
  0,
  0,
  ...Array.from({ length: 53 }, () => 0),
];

describe('a device through WebHID', () => {
  it.effect(
    'is opened, read through its driver as it reports, and closed once its scope closes',
    () =>
      Effect.gen(function* () {
        const device = new Recorded();
        const scope = yield* Scope.make();
        const connection = yield* Hid.connect(device, DualSense.driver).pipe(Scope.provide(scope));
        const before = connection.pad();

        device.send(0x01, crossPressed);
        const after = connection.pad();
        yield* Scope.close(scope, Exit.void);

        expect(before).toEqual(Option.none());
        expect(Option.map(after, ({ buttons }) => buttons.South)).toEqual(Option.some(1));
        expect(device.opened).toBe(false);
        expect(connection.model).toEqual({ vendorId: 0x054c, productId: 0x0ce6 });
      }),
  );
});
