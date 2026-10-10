import { Option, Schema } from 'effect';

/**
 * What a host and its clients say to each other, apart from the snapshots themselves.
 *
 * - Reliable, host to client: `Welcome`, naming the entity the client controls.
 * - Unreliable, host to client: snapshots, as `Snapshot` encodes them.
 * - Unreliable, client to host: `Inputs`, the client's latest inputs repeated, so one lost message loses none of them.
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

const WelcomeJson = Schema.fromJsonString(Welcome);
const InputsJson = Schema.fromJsonString(Inputs);

export const encodeWelcome = (welcome: Welcome): string =>
  Schema.encodeSync(WelcomeJson)(welcome) as string;
export const decodeWelcome = (text: string): Option.Option<Welcome> =>
  Schema.decodeOption(WelcomeJson)(text);

export const encodeInputs = (inputs: Inputs): string =>
  Schema.encodeSync(InputsJson)(inputs) as string;

/** The inputs a client sent; `None` for anything else, including more inputs than a client ever repeats. */
export const decodeInputs = (text: string): Option.Option<Inputs> =>
  Option.filter(
    Schema.decodeOption(InputsJson)(text),
    (decoded) => decoded.inputs.length <= MAX_REPEATED_INPUTS,
  );
