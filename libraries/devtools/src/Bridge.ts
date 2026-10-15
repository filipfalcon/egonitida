import { Cause, Effect, Option, Queue, Random, Schema, type Scope, Stream } from 'effect';
import type * as Inspect from '#src/Inspect.ts';

/**
 * A host's side of the way to it from a relay, such as the development server's: it says hello with an id of its own, and answers what the relay asks of it through an inspector, each answer with the id it was asked with, so the relay hands it to whoever asked and no one else. What is asked of another host, or is no message at all, it leaves alone, since a channel may carry the messages of many.
 */

/** The name messages travel under on the development server's channel. */
export const EVENT = 'egonitida:devtools';

/** What a host or a page that draws one sends a relay: hello, with its id and its game's name, or the host it draws; an answer to a request; or why it refused one. */
export const FromHost = Schema.Union([
  Schema.TaggedStruct('Hello', { host: Schema.String, name: Schema.String }),
  /** A page that draws a host, by the host's id, says hello with an id of its own. */
  Schema.TaggedStruct('Showing', { page: Schema.String, host: Schema.String }),
  Schema.TaggedStruct('Answered', { id: Schema.Int, answer: Schema.Unknown }),
  Schema.TaggedStruct('Unanswered', { id: Schema.Int, reason: Schema.String }),
]);
export type FromHost = typeof FromHost.Type;

/** What a relay sends a host or a page: a request for one host, by its id, a capture of what one page draws, or a question who is there. */
export const ToHost = Schema.Union([
  Schema.TaggedStruct('Ask', { id: Schema.Int, host: Schema.String, request: Schema.Unknown }),
  /** A shot of what a page draws now, at most `width` pixels across if given. */
  Schema.TaggedStruct('Capture', {
    id: Schema.Int,
    page: Schema.String,
    width: Schema.OptionFromOptionalKey(Schema.Int),
  }),
  Schema.TaggedStruct('Who', {}),
]);
export type ToHost = typeof ToHost.Type;

const unanswered = (id: number, reason: string): FromHost => ({ _tag: 'Unanswered', id, reason });

/** A way between a host and a relay: what the host sends, and what reaches it, as it arrived. */
export interface Channel {
  readonly send: (message: FromHost) => Effect.Effect<void>;
  readonly received: Stream.Stream<unknown>;
}

/** Answers what a relay asks over `channel` through `inspector`, until the scope closes, as a host of the game called `name`. */
export const serve = (
  channel: Channel,
  inspector: Inspect.Inspector,
  options: {
    readonly name: string;
    /** The host's id, if the page that draws it chose one, so the page can name it; one of its own otherwise. */
    readonly id?: string;
  },
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    const id = options.id ?? `${options.name}-${(yield* Random.nextInt).toString(36)}`;
    const hello: FromHost = { _tag: 'Hello', host: id, name: options.name };
    const answer = (message: ToHost) => {
      if (message._tag === 'Who') {
        return channel.send(hello);
      }
      if (message._tag === 'Capture' || message.host !== id) {
        return Effect.void;
      }
      return inspector.answerUnknown(message.request).pipe(
        Effect.match({
          onSuccess: (answered): FromHost => ({
            _tag: 'Answered',
            id: message.id,
            answer: answered,
          }),
          onFailure: ({ reason }): FromHost => ({ _tag: 'Unanswered', id: message.id, reason }),
        }),
        // Answering that breaks, such as a step that throws, is a bug in the game or the engine: it is told to whoever asked and to the console, and the bridge goes on answering.
        Effect.catchCause((cause) =>
          Effect.as(
            Effect.logError('Answering a request broke', cause),
            unanswered(message.id, `answering broke: ${Cause.pretty(cause)}`),
          ),
        ),
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
