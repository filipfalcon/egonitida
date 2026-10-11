import { Option, Schema } from 'effect';

/**
 * What a host and its clients say to each other, apart from the snapshots themselves.
 *
 * - Reliable, host to client: `Welcome`, naming the entity the client controls, and `Answer`, to a question the client asked.
 * - Unreliable, host to client: snapshots, as `Snapshot` encodes them, each followed by `Acked`, the number of the client's newest input the world took in, so a client predicting its own player knows which of its inputs are yet to be.
 * - Unreliable, client to host: `Inputs`, the client's latest inputs repeated, so one lost message loses none of them.
 * - Reliable, client to host: `Hold` and `Release`, asking the host to stop time and let it go again, `Act`, an action the player takes, encoded by its own schema, `Control`, for whatever listens beside the host, and `Ask`, a question for whatever answers beside it, which the answer names by its `id`.
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

/** The number of the newest input of a client's that the world at `tick` took in; none taken yet is 0. */
const Acked = Schema.TaggedStruct('Acked', { tick: Schema.Int, seq: Schema.Int });
export type Acked = typeof Acked.Type;
const AckedJson = Schema.fromJsonString(Acked);

/** What the world took in of a client's inputs, as it travels to the client. */
export const encodeAcked = (acked: Acked): string => Schema.encodeSync(AckedJson)(acked);
/** What the world took in of this client's inputs; `None` for anything else, such as a snapshot. */
export const decodeAcked = (text: string): Option.Option<Acked> =>
  Schema.decodeOption(AckedJson)(text);

const ClientReliable = Schema.Union([
  Schema.TaggedStruct('Hold', {}),
  Schema.TaggedStruct('Release', {}),
  Schema.TaggedStruct('Act', { action: Schema.Unknown }),
  Schema.TaggedStruct('Control', { payload: Schema.Unknown }),
  Schema.TaggedStruct('Ask', { id: Schema.Int, question: Schema.Unknown }),
]);
export type ClientReliable = typeof ClientReliable.Type;

/** The answer to the question a client asked as `id`: what was answered, or why nothing was. */
const Answer = Schema.TaggedStruct('Answer', {
  id: Schema.Int,
  outcome: Schema.Union([
    Schema.TaggedStruct('Answered', { answer: Schema.Unknown }),
    Schema.TaggedStruct('Unanswered', { reason: Schema.String }),
  ]),
});
export type Answer = typeof Answer.Type;

const WelcomeJson = Schema.fromJsonString(Welcome);
const AnswerJson = Schema.fromJsonString(Answer);

/** An answer as it travels to the client that asked. */
export const encodeAnswer = (answer: Answer): string => Schema.encodeSync(AnswerJson)(answer);
/** The answer to a question this client asked; `None` for anything else. */
export const decodeAnswer = (text: string): Option.Option<Answer> =>
  Schema.decodeOption(AnswerJson)(text);
const ClientReliableJson = Schema.fromJsonString(ClientReliable);

/** A client's reliable message as it travels to the host. */
export const encodeClientReliable = (message: ClientReliable): string =>
  Schema.encodeSync(ClientReliableJson)(message);
/** A client's reliable message; `None` for anything else. */
export const decodeClientReliable = (text: string): Option.Option<ClientReliable> =>
  Schema.decodeOption(ClientReliableJson)(text);
const InputsJson = Schema.fromJsonString(Inputs);

/** A welcome as it travels to the client joining. */
export const encodeWelcome = (welcome: Welcome): string => Schema.encodeSync(WelcomeJson)(welcome);
/** The welcome the host sent this client; `None` for anything else. */
export const decodeWelcome = (text: string): Option.Option<Welcome> =>
  Schema.decodeOption(WelcomeJson)(text);

/** A client's latest inputs as they travel to the host. */
export const encodeInputs = (inputs: Inputs): string => Schema.encodeSync(InputsJson)(inputs);

/** The inputs a client sent; `None` for anything else, including more inputs than a client ever repeats. */
export const decodeInputs = (text: string): Option.Option<Inputs> =>
  Option.filter(
    Schema.decodeOption(InputsJson)(text),
    (decoded) => decoded.inputs.length <= MAX_REPEATED_INPUTS,
  );
