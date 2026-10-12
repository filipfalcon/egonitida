import { Effect, Option, Random, Schema, type Scope, Stream } from 'effect';
import * as Bridge from '#src/Bridge.ts';

/**
 * A page's side of the way to it from a relay: a page that draws a host says so, with an id of its own and the host's, and answers a capture of it with a shot of what it draws now, so an agent sees what a person would. It knows nothing of how the page draws; whatever runs it gives it how to capture.
 */

/** A shot of what a page draws: a PNG, as base64, and its size in pixels. */
export const Shot = Schema.Struct({ png: Schema.String, width: Schema.Int, height: Schema.Int });
export type Shot = typeof Shot.Type;

/** How a page takes a shot of what it draws, at most `width` pixels across if given; or why it could not. */
export type Capture = (width: Option.Option<number>) => Effect.Effect<Shot, string>;

/** Answers the captures a relay asks of this page over `channel`, as a page drawing `host`, until the scope closes. */
export const serve = (
  channel: Bridge.Channel,
  options: { readonly host: string; readonly capture: Capture },
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    const page = `page-${(yield* Random.nextInt).toString(36)}`;
    const hello: Bridge.FromHost = { _tag: 'Showing', page, host: options.host };
    const answer = (message: Bridge.ToHost) => {
      if (message._tag === 'Who') {
        return channel.send(hello);
      }
      if (message._tag !== 'Capture' || message.page !== page) {
        return Effect.void;
      }
      return options.capture(message.width).pipe(
        Effect.match({
          onSuccess: (shot): Bridge.FromHost => ({
            _tag: 'Answered',
            id: message.id,
            answer: shot,
          }),
          onFailure: (reason): Bridge.FromHost => ({ _tag: 'Unanswered', id: message.id, reason }),
        }),
        Effect.flatMap(channel.send),
      );
    };
    yield* channel.received.pipe(
      Stream.filterMap((message) => Schema.decodeUnknownResult(Bridge.ToHost)(message)),
      Stream.runForEach(answer),
      Effect.forkScoped,
    );
    yield* channel.send(hello);
  });
