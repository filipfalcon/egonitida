import { describe, expect, it } from '@effect/vitest';
import { Effect, Exit, Fiber, Option, Scope, Stream } from 'effect';
import * as DualSense from '#src/DualSense.ts';
import * as Haptics from '#src/Haptics.ts';
import * as Hid from '#src/Hid.ts';

/** A DualSense as WebHID gives one, which sends the reports a test hands it. */
class Recorded extends EventTarget {
  readonly vendorId = 0x054c;
  readonly productId = 0x0ce6;
  readonly productName = 'DualSense Wireless Controller';
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

/** A DualSense that takes each report only when a test lets it, as a device over Bluetooth takes its time. */
class Slow extends Recorded {
  private waiting: Array<() => void> = [];
  private flowing = false;
  override async sendReport(reportId: number, data: BufferSource) {
    if (!this.flowing) {
      await new Promise<void>((done) => this.waiting.push(done));
    }
    await super.sendReport(reportId, data);
  }
  /** Lets every report through from now on, as when the test is done holding them up. */
  flow() {
    this.flowing = true;
    this.letThrough();
  }
  /** Lets every report on its way through. */
  letThrough() {
    const waiting = this.waiting;
    this.waiting = [];
    for (const done of waiting) {
      done();
    }
  }
  get onTheWay() {
    return this.waiting.length;
  }
}

/** A DualSense whose reports never get through, as one unplugged mid-write. */
class Failing extends Recorded {
  override async sendReport() {
    throw new Error('The device was disconnected.');
  }
}

/** The devices a browser reaches through WebHID, as a test hands them: those already granted, the one a player chooses when asked, and devices plugged in and pulled out. */
class Source extends EventTarget {
  granted: Array<Recorded> = [];
  chosen: Array<Recorded> = [];
  async getDevices() {
    return this.granted;
  }
  async requestDevice() {
    this.granted.push(...this.chosen);
    return this.chosen;
  }
  plug(device: Recorded) {
    this.granted.push(device);
    this.dispatchEvent(Object.assign(new Event('connect'), { device }));
  }
  pull(device: Recorded) {
    this.granted = this.granted.filter((granted) => granted !== device);
    this.dispatchEvent(Object.assign(new Event('disconnect'), { device }));
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
    'is felt through its driver: its motors turned until turned otherwise, its triggers as held',
    () =>
      Effect.gen(function* () {
        const device = new Recorded();
        const connection = yield* Hid.connect(device, DualSense.driver);
        /** The strong motor, and the right trigger's effect, of each report sent. */
        const felt = () => device.sent.map(({ bytes }) => [bytes[3], bytes[10]]);

        yield* connection.felt.motors({ strong: 1, weak: 0 });
        yield* connection.felt.triggers({
          left: Haptics.free,
          right: { _tag: 'Resisting', from: 0, strength: 1 },
        });
        yield* connection.felt.motors(Haptics.stillMotors);

        expect(felt()).toEqual([
          [255, 0x05],
          [255, 0x21],
          [0, 0x21],
        ]);
        expect(device.sent.map(({ bytes }) => bytes.length)).toEqual([47, 47, 47]);
        expect(device.sent.map(({ reportId }) => reportId)).toEqual([0x02, 0x02, 0x02]);
      }).pipe(Effect.scoped),
  );

  it.effect('sends nothing for what the device already has', () =>
    Effect.gen(function* () {
      const device = new Recorded();
      const connection = yield* Hid.connect(device, DualSense.driver);
      const resisting = {
        left: Haptics.free,
        right: { _tag: 'Resisting', from: 0, strength: 1 },
      } as const;

      yield* connection.felt.triggers(resisting);
      yield* connection.felt.triggers(resisting);
      yield* connection.lit.colour({ red: 0, green: 0, blue: 1 });
      yield* connection.lit.colour({ red: 0, green: 0, blue: 1 });

      expect(device.sent).toHaveLength(2);
    }).pipe(Effect.scoped),
  );

  it.live('sends one report at a time, and after it only the newest of what came meanwhile', () =>
    Effect.gen(function* () {
      const device = new Slow();
      const connection = yield* Hid.connect(device, DualSense.driver);
      const blue = (shade: number) => connection.lit.colour({ red: 0, green: 0, blue: shade / 10 });

      // The first goes on its way; the nine after it come while it is.
      yield* Effect.forkChild(blue(1));
      yield* Effect.sleep('10 millis');
      for (let shade = 2; shade <= 10; shade += 1) {
        yield* Effect.forkChild(blue(shade));
      }
      yield* Effect.sleep('10 millis');
      const onTheWay = device.onTheWay;
      device.letThrough();
      yield* Effect.sleep('10 millis');
      device.letThrough();
      yield* Effect.sleep('10 millis');

      const shades = device.sent.map(({ bytes }) => bytes[46]);
      device.flow();

      expect(onTheWay).toBe(1);
      expect(shades).toEqual([26, 255]);
    }).pipe(Effect.scoped),
  );

  describe('pooled', () => {
    it.live(
      'connects the devices granted before, each once however often it looks, by their names',
      () =>
        Effect.gen(function* () {
          const source = new Source();
          source.granted = [new Recorded()];
          const pool = yield* Hid.pool([DualSense.driver], Option.some(source));

          yield* pool.scan;
          yield* pool.scan;

          expect(pool.connections().map(({ name }) => name)).toEqual([
            'DualSense Wireless Controller',
          ]);
        }).pipe(Effect.scoped),
    );

    it.live(
      'connects a device plugged in or chosen, and lets go of one pulled out, saying so',
      () =>
        Effect.gen(function* () {
          const source = new Source();
          const pool = yield* Hid.pool([DualSense.driver], Option.some(source));
          const changes = yield* pool.changes.pipe(
            Stream.take(3),
            Stream.runCollect,
            Effect.forkChild,
          );
          yield* Effect.sleep('10 millis');
          const plugged = new Recorded();
          source.chosen = [new Recorded()];

          source.plug(plugged);
          yield* Effect.sleep('10 millis');
          yield* pool.request;
          const both = pool.connections().length;
          source.pull(plugged);
          yield* Effect.sleep('10 millis');

          expect(both).toBe(2);
          expect(pool.connections()).toHaveLength(1);
          expect(plugged.opened).toBe(false);
          expect(yield* Fiber.join(changes)).toEqual([
            { _tag: 'Connected', name: 'DualSense Wireless Controller' },
            { _tag: 'Connected', name: 'DualSense Wireless Controller' },
            { _tag: 'Disconnected', name: 'DualSense Wireless Controller' },
          ]);
        }).pipe(Effect.scoped),
    );

    it.live('says once why a device cannot be felt, however often it fails the same way', () =>
      Effect.gen(function* () {
        const source = new Source();
        source.granted = [new Failing()];
        const pool = yield* Hid.pool([DualSense.driver], Option.some(source));
        const changes = yield* pool.changes.pipe(
          Stream.take(1),
          Stream.runCollect,
          Effect.forkChild,
        );
        yield* Effect.sleep('10 millis');

        const [pad] = pool.connections();
        if (pad !== undefined) {
          yield* pad.felt.motors({ strong: 1, weak: 0 });
          yield* pad.felt.motors({ strong: 0.5, weak: 0 });
        }

        expect(yield* Fiber.join(changes)).toEqual([
          {
            _tag: 'Failed',
            name: 'DualSense Wireless Controller',
            reason: 'The device was disconnected.',
          },
        ]);
      }).pipe(Effect.scoped),
    );
  });
});
