import { Option, Schema } from 'effect';

/**
 * The messages of the spike, grouped by the channel they travel on. Everything on the unreliable channel is written to survive being lost, duplicated, or reordered: inputs repeat the last few, and every snapshot is whole and numbered by its tick.
 */

/** How many of its latest inputs a client repeats in each message, so one lost message loses no input. */
export const MAX_REPEATED_INPUTS = 8;

const Vector2 = Schema.Tuple([Schema.Finite, Schema.Finite]);

// Client → server, unreliable

const Inputs = Schema.TaggedStruct('Inputs', {
  inputs: Schema.Array(Schema.Struct({ seq: Schema.Int, move: Vector2 })),
});
const Ping = Schema.TaggedStruct('Ping', { sentAt: Schema.Finite });

export const ClientUnreliable = Schema.Union([Inputs, Ping]);
export type ClientUnreliable = typeof ClientUnreliable.Type;

// Server → client, reliable

const Welcome = Schema.TaggedStruct('Welcome', { playerId: Schema.String, stepRate: Schema.Int });

export const ServerReliable = Welcome;
export type ServerReliable = typeof ServerReliable.Type;

// Server → client, unreliable

const Snapshot = Schema.TaggedStruct('Snapshot', {
  tick: Schema.Int,
  players: Schema.Array(
    Schema.Struct({ id: Schema.String, position: Vector2, lastSeq: Schema.Int }),
  ),
});
const Pong = Schema.TaggedStruct('Pong', { sentAt: Schema.Finite, tick: Schema.Int });

export const ServerUnreliable = Schema.Union([Snapshot, Pong]);
export type ServerUnreliable = typeof ServerUnreliable.Type;

// Encoding

const codec = <S extends Schema.Codec<unknown, unknown>>(schema: S) => {
  const json = Schema.fromJsonString(schema);
  return {
    encode: (message: S['Type']): string => Schema.encodeSync(json)(message),
    decode: (text: string): Option.Option<S['Type']> => Schema.decodeOption(json)(text),
  };
};

const clientUnreliable = codec(ClientUnreliable);
const serverReliable = codec(ServerReliable);
const serverUnreliable = codec(ServerUnreliable);

// A move longer than one would let a client run faster than anyone else; a message holding more inputs than any client repeats is not one a client sent.
const isWithinLimits = (message: ClientUnreliable): boolean =>
  message._tag !== 'Inputs' ||
  (message.inputs.length <= MAX_REPEATED_INPUTS &&
    message.inputs.every((input) => Math.hypot(input.move[0], input.move[1]) <= 1 + 1e-9));

export const encodeClientUnreliable = clientUnreliable.encode;
export const decodeClientUnreliable = (text: string): Option.Option<ClientUnreliable> =>
  Option.filter(clientUnreliable.decode(text), isWithinLimits);

export const encodeServerReliable = serverReliable.encode;
export const decodeServerReliable = serverReliable.decode;

export const encodeServerUnreliable = serverUnreliable.encode;
export const decodeServerUnreliable = serverUnreliable.decode;
