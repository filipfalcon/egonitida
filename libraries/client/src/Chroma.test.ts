import { describe, expect, it } from '@effect/vitest';
import { Effect, Exit, Scope } from 'effect';
import { HttpClient, HttpClientError, HttpClientResponse } from 'effect/http';
import { TestClock } from 'effect/testing';
import * as Chroma from '#src/Chroma.ts';

const app: Chroma.App = {
  title: 'Horde',
  description: 'Survive the horde.',
  author: { name: 'LightOcean', contact: 'https://github.com/filipfalcon/lightocean' },
  category: 'game',
};

/** Where the connection that Chroma makes is reached. */
const CONNECTION = 'http://localhost:55000/chromasdk';

/** Chroma as Razer's software serves it: a connection for the app that asks, and every other request answered as done; what is asked of it is kept in order. */
const recording = () => {
  const asked: Array<{ readonly method: string; readonly url: string; readonly body: unknown }> =
    [];
  const client = HttpClient.make((request) =>
    Effect.sync(() => {
      const body =
        request.body._tag === 'Uint8Array'
          ? JSON.parse(new TextDecoder().decode(request.body.body))
          : undefined;
      asked.push({ method: request.method, url: request.url, body });
      const answer = request.method === 'POST' ? { sessionid: 7, uri: CONNECTION } : { result: 0 };
      return HttpClientResponse.fromWeb(request, new Response(JSON.stringify(answer)));
    }),
  );
  return { asked, client };
};

describe('Chroma', () => {
  it.effect(
    'lights every kind of Razer device through a connection of its own, kept alive, and ended with the scope',
    () => {
      const chroma = recording();
      return Effect.gen(function* () {
        const scope = yield* Scope.make();
        const lit = yield* Chroma.connect(app).pipe(Scope.provide(scope));

        yield* lit.colour({ red: 1, green: 0.5, blue: 0 });
        const lighting = chroma.asked.length;
        yield* TestClock.adjust('10 seconds');
        yield* Scope.close(scope, Exit.void);

        expect(chroma.asked[0]).toEqual({
          method: 'POST',
          url: 'http://localhost:54235/razer/chromasdk',
          body: {
            title: 'Horde',
            description: 'Survive the horde.',
            author: { name: 'LightOcean', contact: 'https://github.com/filipfalcon/lightocean' },
            device_supported: ['keyboard', 'mouse', 'mousepad', 'headset', 'keypad', 'chromalink'],
            category: 'game',
          },
        });
        // Its colours are blue, green, and red, from the highest byte down.
        expect(chroma.asked.slice(1, lighting)).toEqual(
          Chroma.DEVICES.map((device) => ({
            method: 'PUT',
            url: `${CONNECTION}/${device}`,
            body: { effect: 'CHROMA_STATIC', param: { color: 0x0080ff } },
          })),
        );
        expect(chroma.asked.slice(lighting).map(({ method, url }) => [method, url])).toEqual([
          ['PUT', `${CONNECTION}/heartbeat`],
          ['DELETE', CONNECTION],
        ]);
      }).pipe(Effect.provideService(HttpClient.HttpClient, chroma.client));
    },
  );

  it.effect('is refused where no Razer software responds', () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(Effect.scoped(Chroma.connect(app)));

      expect(Exit.isFailure(exit)).toBe(true);
    }).pipe(
      Effect.provideService(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.fail(
            new HttpClientError.HttpClientError({
              reason: new HttpClientError.TransportError({ request }),
            }),
          ),
        ),
      ),
    ),
  );
});
