import { Data, Effect, Schema, type Scope } from 'effect';
import { HttpClient, HttpClientRequest, HttpClientResponse } from 'effect/http';
import type * as Lighting from '#src/Lighting.ts';

/**
 * Razer's devices lit through Chroma, the software of Razer's that holds them: a page asks it for a session over its REST API on the player's own machine, lights every kind of device it knows through that session, keeps the session alive while it is used, and ends it once its scope closes, when Chroma gives the devices back their own lights. Where no Razer software answers, a page asks in vain and plays on unlit.
 */

/** The kinds of device Chroma lights. */
export type Device = 'keyboard' | 'mouse' | 'mousepad' | 'headset' | 'keypad' | 'chromalink';

export const DEVICES: ReadonlyArray<Device> = [
  'keyboard',
  'mouse',
  'mousepad',
  'headset',
  'keypad',
  'chromalink',
];

/** What Chroma is told of the app that asks for a session, and shows the player. */
export interface App {
  readonly title: string;
  readonly description: string;
  readonly author: { readonly name: string; readonly contact: string };
  readonly category: 'application' | 'game';
}

export class Refused extends Data.TaggedError('Refused')<{ readonly reason: string }> {}

/** Where Chroma's REST API is served on the player's machine. */
export const URL = 'http://localhost:54235/razer/chromasdk';

/** How long Chroma keeps a session it has heard nothing from, less a margin. */
const HEARTBEAT = '10 seconds';

/** A session Chroma started, where it is reached. */
const Session = Schema.Struct({ uri: Schema.String });

/** A colour as Chroma takes it: blue, green, and red, a byte each, from the highest down. */
const colourOf = ({ red, green, blue }: Lighting.Colour) => {
  const byte = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 255);
  return (byte(blue) << 16) | (byte(green) << 8) | byte(red);
};

/** Razer's devices, lit through a session Chroma starts for `app`, until the scope closes. */
export const connect = (
  app: App,
): Effect.Effect<Lighting.Lit, Refused, HttpClient.HttpClient | Scope.Scope> =>
  Effect.gen(function* () {
    const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient);
    const { uri } = yield* Effect.acquireRelease(
      client
        .execute(
          HttpClientRequest.bodyJsonUnsafe(HttpClientRequest.post(URL), {
            ...app,
            device_supported: DEVICES,
          }),
        )
        .pipe(
          Effect.flatMap(HttpClientResponse.schemaBodyJson(Session)),
          Effect.mapError(
            (cause) => new Refused({ reason: `Chroma did not start a session: ${cause.message}` }),
          ),
        ),
      ({ uri }) => Effect.ignore(client.execute(HttpClientRequest.delete(uri))),
    );
    yield* Effect.sleep(HEARTBEAT).pipe(
      Effect.andThen(Effect.ignore(client.execute(HttpClientRequest.put(`${uri}/heartbeat`)))),
      Effect.forever,
      Effect.forkScoped,
    );
    return {
      colour: (colour) => {
        const effect = { effect: 'CHROMA_STATIC', param: { color: colourOf(colour) } };
        return Effect.forEach(
          DEVICES,
          (device) =>
            Effect.ignore(
              client.execute(
                HttpClientRequest.bodyJsonUnsafe(HttpClientRequest.put(`${uri}/${device}`), effect),
              ),
            ),
          { discard: true },
        );
      },
    };
  });
