import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import { HttpClient, HttpClientError, HttpClientResponse } from 'effect/http';
import { Scores, http } from '#src/scores.ts';

/** The scores Worker as a page reaches it, answering every POST with `answer`; what it was sent is kept, in order. */
const worker = (answer: (sent: unknown) => Response) => {
  const sent: Array<{ readonly url: string; readonly body: unknown }> = [];
  const client = HttpClient.make((request) =>
    Effect.sync(() => {
      const body =
        request.body._tag === 'Uint8Array'
          ? JSON.parse(new TextDecoder().decode(request.body.body))
          : undefined;
      sent.push({ url: request.url, body });
      return HttpClientResponse.fromWeb(request, answer(body));
    }),
  );
  return { sent, layer: Layer.succeed(HttpClient.HttpClient, client) };
};

describe('scores kept by the scores Worker', () => {
  it.effect('are saved by posting the score there, which tells the best kept so far', () => {
    const scores = worker(() => Response.json({ best: 12 }));
    return Effect.gen(function* () {
      const best = yield* (yield* Scores).save(7);

      expect(best).toBe(12);
      expect(scores.sent).toEqual([{ url: 'http://scores.test/scores', body: { score: 7 } }]);
    }).pipe(Effect.provide(http('http://scores.test/scores').pipe(Layer.provide(scores.layer))));
  });

  it.effect('are not saved, saying why, when the Worker refuses or cannot be reached', () => {
    const refusing = worker(
      () => new Response('The best score could not be kept.', { status: 503 }),
    );
    const unreachable = Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) =>
        Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({ request }),
          }),
        ),
      ),
    );
    const reasonOf = (layer: Layer.Layer<HttpClient.HttpClient>) =>
      Effect.gen(function* () {
        return yield* (yield* Scores).save(7);
      }).pipe(
        Effect.as('saved'),
        Effect.catchTag('Unsaved', ({ reason }) => Effect.succeed(reason)),
        Effect.provide(http('http://scores.test/scores').pipe(Layer.provide(layer))),
      );

    return Effect.gen(function* () {
      expect(yield* reasonOf(refusing.layer)).toContain('503');
      expect(yield* reasonOf(unreachable)).toContain('could not be reached');
    });
  });
});
