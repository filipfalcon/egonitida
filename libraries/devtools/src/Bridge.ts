import { Effect, Option, Queue, Random, Schema, type Scope, Stream } from 'effect';
import type * as Inspect from '#src/Inspect.ts';

/**
 * A host's side of the way to it from a relay, such as the development server's: it says hello with an id of its own, and answers what the relay asks of it through an inspector, each answer with the id it was asked with, so the relay hands it to whoever asked and no one else. What is asked of another host, or is no message at all, it leaves alone, since a channel may carry the messages of many.
 */

/** The name messages travel under on the development server's channel. */
export const EVENT = 'lightocean:devtools';

/** What a host sends a relay: hello, with its id and its game's name, or an answer to a request, or why it refused one. */
export const FromHost = Schema.Union([
  Schema.TaggedStruct('Hello', { host: Schema.String, name: Schema.String }),
  Schema.TaggedStruct('Answer', { id: Schema.Int, answer: Schema.Unknown }),
  Schema.TaggedStruct('Refusal', { id: Schema.Int, reason: Schema.String }),
]);
export type FromHost = typeof FromHost.Type;

/** What a relay sends a host: a request for one host, by its id, or a question who is there. */
export const ToHost = Schema.Union([
  Schema.TaggedStruct('Ask', { id: Schema.Int, host: Schema.String, request: Schema.Unknown }),
  Schema.TaggedStruct('Who', {}),
]);
export type ToHost = typeof ToHost.Type;

/** A way between a host and a relay: what the host sends, and what reaches it, as it arrived. */
export interface Channel {
  readonly send: (message: FromHost) => Effect.Effect<void>;
  readonly received: Stream.Stream<unknown>;
}

/** Answers what a relay asks over `channel` through `inspector`, until the scope closes, as a host of the game called `name`. */
export const serve = (
  channel: Channel,
  inspector: Inspect.Inspector,
  options: { readonly name: string },
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    const id = `${options.name}-${(yield* Random.nextInt).toString(36)}`;
    const hello: FromHost = { _tag: 'Hello', host: id, name: options.name };
    const answer = (message: ToHost) => {
      if (message._tag === 'Who') {
        return channel.send(hello);
      }
      if (message.host !== id) {
        return Effect.void;
      }
      return inspector.answerUnknown(message.request).pipe(
        Effect.match({
          onSuccess: (answered): FromHost => ({ _tag: 'Answer', id: message.id, answer: answered }),
          onFailure: ({ reason }): FromHost => ({ _tag: 'Refusal', id: message.id, reason }),
        }),
        Effect.flatMap(channel.send),
      );
    };
    yield* channel.received.pipe(
      Stream.filterMap((message) => Schema.decodeUnknownResult(ToHost)(message)),
      Stream.runForEach(answer),
      Effect.forkScoped,
    );
    yield* channel.send(hello);
  });

/**
 * The development server's channel, from wherever this module runs with one, such as a worker in development: none elsewhere. It listens through this module's own connection to the server, which outlives a game module run again on a change, so a bridge keeps answering through a reload of the game.
 */
export const vite: Option.Option<Channel> = Option.map(
  Option.fromNullishOr(import.meta.hot),
  (hot): Channel => ({
    send: (message) =>
      Schema.encodeEffect(FromHost)(message).pipe(
        // A message the host made itself always encodes; one that does not is a bug here.
        Effect.orDie,
        Effect.flatMap((encoded) => Effect.sync(() => hot.send(EVENT, encoded))),
      ),
    received: Stream.callback<unknown>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const listener = (data: unknown) => {
            Queue.offerUnsafe(queue, data);
          };
          hot.on(EVENT, listener);
          return listener;
        }),
        (listener) => Effect.sync(() => hot.off(EVENT, listener)),
      ),
    ),
  }),
);
