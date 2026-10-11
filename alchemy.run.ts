import * as Alchemy from 'alchemy';
import * as Cloudflare from 'alchemy/Cloudflare';
import * as Effect from 'effect/Effect';
import NetSpike from './applications/net-spike/src/Server.ts';
import Scores from './examples/save-score/src/server.ts';

export default Alchemy.Stack(
  'LightOcean',
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const playground = yield* Cloudflare.Website.Foldkit('Playground', {
      rootDir: 'applications/playground',
      dev: { port: 5190, strictPort: true },
      assets: {
        notFoundHandling: 'single-page-application',
      },
    });

    const editor = yield* Cloudflare.Website.Foldkit('Editor', {
      rootDir: 'applications/editor',
      dev: { port: 5191, strictPort: true },
      assets: {
        notFoundHandling: 'single-page-application',
      },
    });

    // The network spike: a Worker in front of one Durable Object per room.
    const netSpike = yield* NetSpike;

    // Where the save-score example keeps the best score: a Worker over a KV namespace.
    const scores = yield* Scores;

    return {
      playground: playground.urls,
      editor: editor.urls,
      netSpike: netSpike.url,
      scores: scores.url,
    };
  }),
);
