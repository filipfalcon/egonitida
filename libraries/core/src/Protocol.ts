import { Option, Schema } from 'effect';

/**
 * What a host and its clients say to each other, apart from the snapshots themselves.
 *
 * - Reliable, host to client: `Welcome`, naming the entity the client controls, and, to a question the client asked, `Answered`, with its answer, or `Unanswered`, with why there is none.
 * - Unreliable, host to client: snapshots, as `Snapshot` encodes them, each followed by `Acked`, the number of the client's newest demands the state took in, so a client predicting its own player knows which of its demands are yet to be; and `Pong`, answering a client's `Ping` at once.
 * - Unreliable, client to host: `Demands`, the client's latest demands repeated, so one lost message loses none of them; and `Ping`, which the host answers as soon as it hears it, outside its steps, so the client times the way there and back.
 * - Reliable, client to host: `Suspend` and `Resume`, asking the host to suspend time and resume it, `Act`, an action the player takes, encoded by its own schema, `Control`, for whatever listens beside the host, and `Ask`, a question for whatever answers beside it, which the reply names by its `id`.
 */

/** How many of its latest demands a client repeats in each message. */
export const MAX_REPEATED_DEMANDS = 8;

const Welcome = Schema.Struct({ entity: Schema.Int, stepRate: Schema.Int });
export type Welcome = typeof Welcome.Type;

const Demands = Schema.Struct({
  demands: Schema.Array(
    Schema.Struct({
      seq: Schema.Int,
      /** Demand values by component name, each encoded by its component's schema. */
      values: Schema.Record(Schema.String, Schema.Unknown),
    }),
  ),
});
export type Demands = typeof Demands.Type;

/** The number of the newest demands of a client's that the state at `tick` took in; none taken yet is 0. */
const Acked = Schema.TaggedStruct('Acked', { tick: Schema.Int, seq: Schema.Int });
export type Acked = typeof Acked.Type;
const AckedJson = Schema.fromJsonString(Acked);

/** What the state took in of a client's demands, as it travels to the client. */
export const encodeAcked = (acked: Acked): string => Schema.encodeSync(AckedJson)(acked);
/** What the state took in of this client's demands; `None` for anything else, such as a snapshot. */
export const decodeAcked = (text: string): Option.Option<Acked> =>
  Schema.decodeOption(AckedJson)(text);

/** A client asking the host to answer at once, as `id`, so it times the way there and back. */
const Ping = Schema.TaggedStruct('Ping', { id: Schema.Int });
export type Ping = typeof Ping.Type;
const PingJson = Schema.fromJsonString(Ping);

/** The host's answer to the client's ping `id`. */
const Pong = Schema.TaggedStruct('Pong', { id: Schema.Int });
export type Pong = typeof Pong.Type;
const PongJson = Schema.fromJsonString(Pong);

/** A client's ping as it travels to the host. */
export const encodePing = (ping: Ping): string => Schema.encodeSync(PingJson)(ping);
/** A client's ping; `None` for anything else, such as its demands. */
export const decodePing = (text: string): Option.Option<Ping> =>
  Schema.decodeOption(PingJson)(text);

/** The host's answer to a ping as it travels to the client. */
export const encodePong = (pong: Pong): string => Schema.encodeSync(PongJson)(pong);
/** The host's answer to this client's ping; `None` for anything else, such as a snapshot. */
export const decodePong = (text: string): Option.Option<Pong> =>
  Schema.decodeOption(PongJson)(text);

const ClientReliable = Schema.Union([
  Schema.TaggedStruct('Suspend', {}),
  Schema.TaggedStruct('Resume', {}),
  Schema.TaggedStruct('Act', { action: Schema.Unknown }),
  Schema.TaggedStruct('Control', { payload: Schema.Unknown }),
  Schema.TaggedStruct('Ask', { id: Schema.Int, question: Schema.Unknown }),
]);
export type ClientReliable = typeof ClientReliable.Type;

/** A host's reliable message besides its welcome: the answer to the question a client asked as `id`, or why it has none. */
const HostReliable = Schema.Union([
  Schema.TaggedStruct('Answered', { id: Schema.Int, answer: Schema.Unknown }),
  Schema.TaggedStruct('Unanswered', { id: Schema.Int, reason: Schema.String }),
]);
export type HostReliable = typeof HostReliable.Type;

const WelcomeJson = Schema.fromJsonString(Welcome);
const HostReliableJson = Schema.fromJsonString(HostReliable);

/** A host's reliable message as it travels to the client that asked. */
export const encodeHostReliable = (message: HostReliable): string =>
  Schema.encodeSync(HostReliableJson)(message);
/** What the host says to a question this client asked; `None` for anything else. */
export const decodeHostReliable = (text: string): Option.Option<HostReliable> =>
  Schema.decodeOption(HostReliableJson)(text);
const ClientReliableJson = Schema.fromJsonString(ClientReliable);

/** A client's reliable message as it travels to the host. */
export const encodeClientReliable = (message: ClientReliable): string =>
  Schema.encodeSync(ClientReliableJson)(message);
/** A client's reliable message; `None` for anything else. */
export const decodeClientReliable = (text: string): Option.Option<ClientReliable> =>
  Schema.decodeOption(ClientReliableJson)(text);
const DemandsJson = Schema.fromJsonString(Demands);

/** A welcome as it travels to the client joining. */
export const encodeWelcome = (welcome: Welcome): string => Schema.encodeSync(WelcomeJson)(welcome);
/** The welcome the host sent this client; `None` for anything else. */
export const decodeWelcome = (text: string): Option.Option<Welcome> =>
  Schema.decodeOption(WelcomeJson)(text);

/** A client's latest demands as they travel to the host. */
export const encodeDemands = (demands: Demands): string => Schema.encodeSync(DemandsJson)(demands);

/** The demands a client sent; `None` for anything else, including more than a client ever repeats. */
export const decodeDemands = (text: string): Option.Option<Demands> =>
  Option.filter(
    Schema.decodeOption(DemandsJson)(text),
    (decoded) => decoded.demands.length <= MAX_REPEATED_DEMANDS,
  );
