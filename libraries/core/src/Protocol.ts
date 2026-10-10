import { Option, Schema } from 'effect';

/**
 * What a host and its clients say to each other, apart from the snapshots themselves.
 *
 * - Reliable, host to client: `Welcome`, naming the entity the client controls.
 * - Unreliable, host to client: snapshots, as `Snapshot` encodes them.
 * - Unreliable, client to host: `Inputs`, the client's latest inputs repeated, so one lost message loses none of them.
 * - Reliable, client to host: `Hold` and `Release`, asking the host to stop time and let it go again, and `Act`, an action the player takes, encoded by its own schema.
 */

/** How many of its latest inputs a client repeats in each message. */
export const MAX_REPEATED_INPUTS = 8;

const Welcome = Schema.Struct({ entity: Schema.Int, stepRate: Schema.Int });
export type Welcome = typeof Welcome.Type;

const Inputs = Schema.Struct({
  inputs: Schema.Array(
    Schema.Struct({
      seq: Schema.Int,
      /** Input values by component name, each encoded by its component's schema. */
      values: Schema.Record(Schema.String, Schema.Unknown),
    }),
  ),
});
export type Inputs = typeof Inputs.Type;

const ClientReliable = Schema.Union([
  Schema.TaggedStruct('Hold', {}),
  Schema.TaggedStruct('Release', {}),
  Schema.TaggedStruct('Act', { action: Schema.Unknown }),
]);
export type ClientReliable = typeof ClientReliable.Type;

const WelcomeJson = Schema.fromJsonString(Welcome);
const ClientReliableJson = Schema.fromJsonString(ClientReliable);

export const encodeClientReliable = (message: ClientReliable): string =>
  Schema.encodeSync(ClientReliableJson)(message);
export const decodeClientReliable = (text: string): Option.Option<ClientReliable> =>
  Schema.decodeOption(ClientReliableJson)(text);
const InputsJson = Schema.fromJsonString(Inputs);

export const encodeWelcome = (welcome: Welcome): string => Schema.encodeSync(WelcomeJson)(welcome);
export const decodeWelcome = (text: string): Option.Option<Welcome> =>
  Schema.decodeOption(WelcomeJson)(text);

export const encodeInputs = (inputs: Inputs): string => Schema.encodeSync(InputsJson)(inputs);

/** The inputs a client sent; `None` for anything else, including more inputs than a client ever repeats. */
export const decodeInputs = (text: string): Option.Option<Inputs> =>
  Option.filter(
    Schema.decodeOption(InputsJson)(text),
    (decoded) => decoded.inputs.length <= MAX_REPEATED_INPUTS,
  );
