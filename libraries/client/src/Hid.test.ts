import { describe, expect, it } from '@effect/vitest';
import { Effect, Exit, Option, Scope } from 'effect';
import { TestClock } from 'effect/testing';
import * as DualSense from '#src/DualSense.ts';
import * as Haptics from '#src/Haptics.ts';
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
  readonly collections = [{ outputReports: [{ reportId: 0x02 }] }];
  /** The reports sent to it, by id, with their bytes; and the feature reports asked of it. */
  readonly sent: Array<{ readonly reportId: number; readonly bytes: ReadonlyArray<number> }> = [];
  readonly asked: Array<number> = [];
  async sendReport(reportId: number, data: BufferSource) {
    const bytes = ArrayBuffer.isView(data)
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      : new Uint8Array(data);
    this.sent.push({ reportId, bytes: [...bytes] });
  }
  async receiveFeatureReport(reportId: number) {
    this.asked.push(reportId);
    return new DataView(new ArrayBuffer(41));
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

  it.effect('is lit through its driver, and goes on being felt as it was', () =>
    Effect.gen(function* () {
      const device = new Recorded();
      const connection = yield* Hid.connect(device, DualSense.driver);

      yield* connection.felt.triggers({
        left: Haptics.free,
        right: { _tag: 'Resisting', from: 0, strength: 1 },
      });
      yield* connection.lit.colour({ red: 0, green: 0, blue: 1 });

      expect(device.sent.at(-1)?.bytes.slice(44, 47)).toEqual([0, 0, 255]);
      expect(device.sent.at(-1)?.bytes[10]).toEqual(0x21);
    }).pipe(Effect.scoped),
  );

  it.effect('asks for what its driver asks for once it opens', () =>
    Effect.gen(function* () {
      const device = new Recorded();

      yield* Effect.scoped(Hid.connect(device, DualSense.driver));

      expect(device.asked).toEqual([0x05]);
    }),
  );

  it.effect(
    'is felt through its driver: its motors rumble for as long as asked, its triggers as held',
    () =>
      Effect.gen(function* () {
        const device = new Recorded();
        const connection = yield* Hid.connect(device, DualSense.driver);
        /** The strong motor, and the right trigger's mode, of each report sent. */
        const felt = () => device.sent.map(({ bytes }) => [bytes[3], bytes[10]]);

        yield* connection.felt.rumble({ strong: 1, weak: 0, seconds: 0.25 });
        yield* connection.felt.triggers({
          left: Haptics.free,
          right: { _tag: 'Resisting', from: 0, strength: 1 },
        });
        const rumbling = felt();
        yield* TestClock.adjust('250 millis');

        expect(rumbling).toEqual([
          [255, 0x05],
          [255, 0x21],
        ]);
        expect(felt()).toEqual([...rumbling, [0, 0x21]]);
        expect(device.sent.map(({ bytes }) => bytes.length)).toEqual([47, 47, 47]);
        expect(device.sent.map(({ reportId }) => reportId)).toEqual([0x02, 0x02, 0x02]);
      }).pipe(Effect.scoped),
  );
});
