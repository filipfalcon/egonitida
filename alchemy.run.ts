import * as Alchemy from 'alchemy';
import * as Cloudflare from 'alchemy/Cloudflare';
import * as Effect from 'effect/Effect';

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

    return {
      playground: playground.urls,
      editor: editor.urls,
    };
  }),
);
