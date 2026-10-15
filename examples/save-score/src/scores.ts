import { Context, Data, Effect, Layer, Schema } from 'effect';
import { HttpClient, HttpClientRequest, HttpClientResponse } from 'effect/http';

/**
 * Where the best score is kept, outside the game: a score saved, and the best kept so far told back. The game reaches it only through its `SaveScore` command, so how it is kept is its Layer's to say: over HTTP to the scores Worker, which keeps the best in Cloudflare KV, or recording, in a test.
 */

/** Why a score was not saved. */
export class Unsaved extends Data.TaggedError('Unsaved')<{ readonly reason: string }> {}

/** Keeping the best score. */
export class Scores extends Context.Service<
  Scores,
  {
    /** Saves `score`, and tells the best kept so far, this one included. */
    readonly save: (score: number) => Effect.Effect<number, Unsaved>;
  }
>()('@egonitida/example-save-score/Scores') {}

/** Scores kept nowhere, every one unsaved for `reason`: where the page was not told where scores are kept. */
export const nowhere = (reason: string): Layer.Layer<Scores> =>
  Layer.succeed(Scores, { save: () => Effect.fail(new Unsaved({ reason })) });

/** What the scores Worker answers a score with: the best kept so far. */
const Answer = Schema.Struct({ best: Schema.Int });

/** Scores kept by the scores Worker at `url`, a score posted there and the best it answers with told back. */
export const http = (url: string): Layer.Layer<Scores, never, HttpClient.HttpClient> =>
  Layer.effect(
    Scores,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      return {
        save: (score) =>
          client
            .execute(HttpClientRequest.bodyJsonUnsafe(HttpClientRequest.post(url), { score }))
            .pipe(
              Effect.mapError(
                () => new Unsaved({ reason: 'Where scores are kept could not be reached.' }),
              ),
              Effect.flatMap((response) =>
                response.status === 200
                  ? HttpClientResponse.schemaBodyJson(Answer)(response).pipe(
                      Effect.map(({ best }) => best),
                      Effect.mapError(
                        () =>
                          new Unsaved({ reason: 'The scores Worker answered with no best score.' }),
                      ),
                    )
                  : Effect.fail(
                      new Unsaved({ reason: `The scores Worker answered ${response.status}.` }),
                    ),
              ),
            ),
      };
    }),
  );
