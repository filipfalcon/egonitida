/// <reference types="w3c-web-hid" />
import { Data, Effect, Option, type Scope } from 'effect';
import type * as Devices from '#src/Devices.ts';
import * as Haptics from '#src/Haptics.ts';
import type * as Lighting from '#src/Lighting.ts';

/**
 * Devices as WebHID reaches them, for what the Gamepad API does not: a device is read through a driver that knows its reports, into the shapes the engine knows, and felt and lit through reports the driver writes, so a game never meets a device's bytes. WebHID is Chromium's only, and a player gives leave for each device once, in answer to a click; a device given leave before is reached again with no asking.
 */

/** A vendor's device, by the ids it reports itself by. */
export interface Model {
  readonly vendorId: number;
  readonly productId: number;
}

/** A report a device sent: its id, and its bytes after the id. */
export interface Report {
  readonly reportId: number;
  readonly data: DataView;
}

/** What a device is asked to make felt and seen at one moment, all of it: how hard its motors turn, from 0 to 1, how its triggers push back, and the colour of its light, if it is asked to have one rather than its own. A driver writes all of it in every report, as devices such as the DualSense take it. */
export interface Output {
  readonly motors: { readonly strong: number; readonly weak: number };
  readonly triggers: Haptics.Triggers;
  readonly light: Option.Option<Lighting.Colour>;
}

/** Nothing felt, and nothing lit: the motors still, the triggers free, and the light the device's own. */
export const still: Output = {
  motors: { strong: 0, weak: 0 },
  triggers: Haptics.freeTriggers,
  light: Option.none(),
};

/** An output report a device takes: its id, and how many bytes it is after the id, where the device says. A browser sends only a report of the length the device says. */
export interface OutputReport {
  readonly reportId: number;
  readonly length: Option.Option<number>;
}

/** What reads a kind of device and writes to it: which devices it reads, what a report of one says, if it is one it knows, and the report that makes an output felt. */
export interface Driver {
  readonly name: string;
  readonly devices: ReadonlyArray<Model>;
  readonly read: (report: Report) => Option.Option<Devices.Pad>;
  /** Feature reports asked of a device once it opens, which some devices take as the sign to say all they can. */
  readonly features: ReadonlyArray<number>;
  /** The report that makes `output` felt on a device that takes the output reports `outputs`, the `sent`th sent to it since it opened; none if the driver writes none. */
  readonly write: (
    output: Output,
    device: { readonly outputs: ReadonlyArray<OutputReport>; readonly sent: number },
  ) => Option.Option<Report>;
}

export class Refused extends Data.TaggedError('Refused')<{ readonly reason: string }> {}

/** Whether this browser has WebHID. */
export const available = (): boolean => typeof navigator !== 'undefined' && 'hid' in navigator;

/** A device connected through its driver: the pad it was last read as, if it has said anything yet, it felt, and it lit. */
export interface Connection {
  readonly model: Model;
  readonly pad: () => Option.Option<Devices.Pad>;
  readonly felt: Haptics.Felt;
  readonly lit: Lighting.Lit;
}

/** As much of a device as is read and written through a driver: its ids, opening and closing it, the reports it sends and takes, and its feature reports, as WebHID's `HIDDevice` gives them. */
export type Device = Pick<
  HIDDevice,
  'vendorId' | 'productId' | 'opened' | 'open' | 'close' | 'sendReport' | 'receiveFeatureReport'
> &
  EventTarget & {
    readonly collections: ReadonlyArray<{
      readonly outputReports?:
        | ReadonlyArray<{
            readonly reportId?: number | undefined;
            readonly items?:
              | ReadonlyArray<{
                  readonly reportSize?: number | undefined;
                  readonly reportCount?: number | undefined;
                }>
              | undefined;
          }>
        | undefined;
    }>;
  };

/** The driver of `device` among `drivers`, if one reads it. */
const driverOf = (drivers: ReadonlyArray<Driver>, device: Device) =>
  Option.fromNullishOr(
    drivers.find((driver) =>
      driver.devices.some(
        ({ vendorId, productId }) => vendorId === device.vendorId && productId === device.productId,
      ),
    ),
  );

/** Reads `device` through `driver`, and makes it felt and lit, until the scope closes. */
export const connect = (
  device: Device,
  driver: Driver,
): Effect.Effect<Connection, Refused, Scope.Scope> =>
  Effect.gen(function* () {
    const latest = { pad: Option.none<Devices.Pad>() };
    const listener = (event: Event) => {
      if (
        'reportId' in event &&
        typeof event.reportId === 'number' &&
        'data' in event &&
        event.data instanceof DataView
      ) {
        const read = driver.read({ reportId: event.reportId, data: event.data });
        if (Option.isSome(read)) {
          latest.pad = read;
        }
      }
    };
    yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: async () => {
          if (!device.opened) {
            await device.open();
          }
          device.addEventListener('inputreport', listener);
          for (const reportId of driver.features) {
            await device.receiveFeatureReport(reportId).catch(() => undefined);
          }
        },
        catch: (cause) =>
          new Refused({
            reason: `${driver.name} could not be opened: ${cause instanceof Error ? cause.message : String(cause)}`,
          }),
      }),
      () =>
        Effect.promise(async () => {
          device.removeEventListener('inputreport', listener);
          await device.close().catch(() => undefined);
        }),
    );
    const scope = yield* Effect.scope;
    const outputs = device.collections.flatMap(({ outputReports }) =>
      (outputReports ?? []).flatMap(({ reportId, items }): ReadonlyArray<OutputReport> => {
        const bits = (items ?? []).reduce(
          (total, { reportSize, reportCount }) => total + (reportSize ?? 0) * (reportCount ?? 0),
          0,
        );
        return reportId === undefined
          ? []
          : [{ reportId, length: bits > 0 ? Option.some(Math.ceil(bits / 8)) : Option.none() }];
      }),
    );
    const written = { output: still, sent: 0 };
    /** Makes `output` felt, as the driver writes it; a report the device does not take is let go. */
    const write = (output: Output) =>
      Effect.suspend(() => {
        written.output = output;
        return Option.match(driver.write(output, { outputs, sent: written.sent }), {
          onNone: () => Effect.void,
          onSome: ({ reportId, data }) => {
            written.sent += 1;
            return Effect.ignore(
              Effect.tryPromise(() =>
                device.sendReport(
                  reportId,
                  Uint8Array.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)),
                ),
              ),
            );
          },
        });
      });
    // Left still as it is let go, so nothing goes on rumbling or pushing back once the page is done with it; its light is given back to it.
    yield* Effect.addFinalizer(() => write(still));
    const felt: Haptics.Felt = {
      // The motors turn until the rumble's time is up, unless something else has turned them since.
      rumble: ({ strong, weak, seconds }) =>
        Effect.suspend(() => {
          const motors = { strong, weak };
          return write({ ...written.output, motors }).pipe(
            Effect.andThen(
              Effect.sleep(`${seconds * 1000} millis`).pipe(
                Effect.andThen(
                  Effect.suspend(() =>
                    written.output.motors === motors
                      ? write({ ...written.output, motors: still.motors })
                      : Effect.void,
                  ),
                ),
                Effect.forkIn(scope),
              ),
            ),
            Effect.asVoid,
          );
        }),
      triggers: (triggers) => Effect.suspend(() => write({ ...written.output, triggers })),
    };
    return {
      model: { vendorId: device.vendorId, productId: device.productId },
      pad: () => latest.pad,
      felt,
      lit: {
        colour: (colour) =>
          Effect.suspend(() => write({ ...written.output, light: Option.some(colour) })),
      },
    };
  });

/** Connects every device of `devices` that one of `drivers` reads, until the scope closes. */
const connectAll = (devices: ReadonlyArray<Device>, drivers: ReadonlyArray<Driver>) =>
  Effect.forEach(devices, (device) =>
    Option.match(driverOf(drivers, device), {
      onNone: () => Effect.succeed([]),
      onSome: (driver) =>
        connect(device, driver).pipe(
          Effect.map((connection) => [connection]),
          Effect.orElseSucceed(() => []),
        ),
    }),
  ).pipe(Effect.map((each) => each.flat()));

/** The devices a player gave leave for before that one of `drivers` reads, connected again with no asking, until the scope closes; none where there is no WebHID. */
export const granted = (
  drivers: ReadonlyArray<Driver>,
): Effect.Effect<ReadonlyArray<Connection>, never, Scope.Scope> =>
  available()
    ? Effect.flatMap(
        Effect.promise(() => navigator.hid.getDevices()),
        (devices) => connectAll(devices, drivers),
      )
    : Effect.succeed([]);

/** Asks the player for leave to reach a device that one of `drivers` reads, and connects what they choose, until the scope closes; to be asked in answer to a click. */
export const request = (
  drivers: ReadonlyArray<Driver>,
): Effect.Effect<ReadonlyArray<Connection>, Refused, Scope.Scope> =>
  available()
    ? Effect.tryPromise({
        try: () =>
          navigator.hid.requestDevice({
            filters: drivers.flatMap(({ devices }) =>
              devices.map(({ vendorId, productId }) => ({ vendorId, productId })),
            ),
          }),
        catch: (cause) =>
          new Refused({ reason: cause instanceof Error ? cause.message : 'No device was chosen.' }),
      }).pipe(Effect.flatMap((devices) => connectAll(devices, drivers)))
    : Effect.fail(
        new Refused({ reason: 'This browser has no WebHID: Chrome, Edge, or Opera have it.' }),
      );
