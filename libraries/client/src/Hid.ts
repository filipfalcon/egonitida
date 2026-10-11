/// <reference types="w3c-web-hid" />
import { Data, Effect, Option, type Scope } from 'effect';
import type * as Devices from '#src/Devices.ts';

/**
 * Devices as WebHID reaches them, for what the Gamepad API does not: a device is read through a driver that knows its reports, into the shapes the engine knows, so a game never meets a device's bytes. WebHID is Chromium's only, and a player gives leave for each device once, in answer to a click; a device given leave before is reached again with no asking.
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

/** What reads a kind of device: which devices it reads, and what a report of one says, if it is one it knows. */
export interface Driver {
  readonly name: string;
  readonly devices: ReadonlyArray<Model>;
  readonly read: (report: Report) => Option.Option<Devices.Pad>;
}

export class Refused extends Data.TaggedError('Refused')<{ readonly reason: string }> {}

/** Whether this browser has WebHID. */
export const available = (): boolean => typeof navigator !== 'undefined' && 'hid' in navigator;

/** A device connected through its driver: the pad it was last read as, if it has said anything yet. */
export interface Connection {
  readonly model: Model;
  readonly pad: () => Option.Option<Devices.Pad>;
}

/** As much of a device as is read through a driver: its ids, opening and closing it, and the reports it sends, as WebHID's `HIDDevice` gives them. */
export type Device = Pick<HIDDevice, 'vendorId' | 'productId' | 'opened' | 'open' | 'close'> &
  EventTarget;

/** The driver of `device` among `drivers`, if one reads it. */
const driverOf = (drivers: ReadonlyArray<Driver>, device: Device) =>
  Option.fromNullishOr(
    drivers.find((driver) =>
      driver.devices.some(
        ({ vendorId, productId }) => vendorId === device.vendorId && productId === device.productId,
      ),
    ),
  );

/** Reads `device` through `driver` until the scope closes. */
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
    return {
      model: { vendorId: device.vendorId, productId: device.productId },
      pad: () => latest.pad,
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
