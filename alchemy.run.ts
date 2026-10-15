import * as Alchemy from 'alchemy';
import * as Cloudflare from 'alchemy/Cloudflare';
import * as Output from 'alchemy/Output';
import * as Effect from 'effect/Effect';
import Scores, { ScoresKV } from './examples/save-score/src/server.ts';
import SharedRooms from './examples/shared-room/src/server.ts';

export default Alchemy.Stack(
  'Nitida',
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

    // The engine's website, with the ocean it runs at its top.
    const website = yield* Cloudflare.Website.Foldkit('Website', {
      rootDir: 'applications/website',
      dev: { port: 5194, strictPort: true },
      assets: {
        notFoundHandling: 'single-page-application',
      },
    });

    // Where the save-score example keeps the best score: a Worker over a KV namespace, which is made first.
    yield* ScoresKV;
    const scores = yield* Scores;

    // The save-score example's page, told where its scores are kept.
    const saveScore = yield* Cloudflare.Website.Vite('SaveScore', {
      rootDir: 'examples/save-score',
      dev: { port: 5192, strictPort: true },
      // Empty while the Worker has no address, which the page tells as scores kept nowhere.
      env: { VITE_SCORES_URL: Output.map(scores.url, (url) => url ?? '') },
    });

    // The shared-room example: a Worker in front of one Durable Object per room, and the page that opens one.
    const sharedRooms = yield* SharedRooms;
    const sharedRoom = yield* Cloudflare.Website.Vite('SharedRoom', {
      rootDir: 'examples/shared-room',
      dev: { port: 5193, strictPort: true },
      // Empty while the Worker has no address, which the page tells as rooms it cannot reach.
      env: { VITE_ROOMS_URL: Output.map(sharedRooms.url, (url) => url ?? '') },
    });

    return {
      playground: playground.urls,
      editor: editor.urls,
      website: website.urls,
      scores: scores.url,
      saveScore: saveScore.url,
      sharedRooms: sharedRooms.url,
      sharedRoom: sharedRoom.url,
    };
  }),
);
