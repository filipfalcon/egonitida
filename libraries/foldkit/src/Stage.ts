import { Clicking, Mirror, View, Viewport } from '@lightocean/client';
import { Data, Effect, Option, type Scope, Stream } from 'effect';
import type { ManagedResource } from 'foldkit';
import type * as Session from '#src/Session.ts';

/**
 * A game shown on a canvas in an application built on Foldkit: drawn through the game's views at every frame the display shows, played by a click on what is drawn, and mirrored as buttons for the keyboard and a screen reader. Foldkit keeps the canvas in its DOM, and says through a Mount when it is there; a Subscription shows the game on it while the application's Model has both the canvas and the session.
 */

/** How a stage is set: the game's views, and what else the scene holds, such as its camera and its lights. */
export interface Options<R> {
  readonly views: ReadonlyArray<View.View<R>>;
  /** How the viewport draws, as bare Three.js does unless told otherwise, such as through a preset like `Viewport.sharp`. */
  readonly viewport?: Viewport.Options | undefined;
  /** Sets the scene up before the first frame, such as where the camera looks from and what lights it. */
  readonly setup?: ((viewport: Viewport.Viewport) => void) | undefined;
  /** What runs beside the stage while it is shown, given its viewport, such as the devtools' `Page.serve`, which captures the canvas for an agent to see what is drawn. */
  readonly alongside?:
    | ((viewport: Viewport.Viewport) => Effect.Effect<void, never, R | Scope.Scope>)
    | undefined;
}

/** Shows `joined` on `viewport` through `options.views` until the scope closes, their rigs drawing its camera for the player who joined: every click on the canvas acts on what is under it, and every labelled entity stands as a button in `mirror`. */
export const show = <R>(
  viewport: Viewport.Viewport,
  joined: Session.Joined,
  options: Options<R> & { readonly mirror: HTMLElement },
): Effect.Effect<void, never, R | Scope.Scope> =>
  Effect.gen(function* () {
    const views = yield* View.make(
      options.views,
      Option.some({ camera: viewport.camera, player: joined.client.entity }),
    );
    viewport.scene.add(views.root);
    options.setup?.(viewport);
    yield* Clicking.serve({
      clicks: viewport.clicks,
      camera: viewport.camera,
      views,
      client: joined.client,
    });
    const mirror = yield* Mirror.make({
      container: options.mirror,
      views,
      scene: viewport.scene,
      client: joined.client,
    });
    if (options.alongside !== undefined) {
      yield* options.alongside(viewport);
    }
    yield* viewport.loop((seconds) =>
      Option.match(joined.drawing.frame(seconds), {
        onNone: () => Effect.void,
        onSome: (frame) => Effect.andThen(views.frame(frame), mirror.frame(frame)),
      }).pipe(Effect.andThen(viewport.render)),
    );
  });

/** Why a stage could not be shown. */
export class Unshown extends Data.TaggedError('Unshown')<{ readonly reason: string }> {}

/** The element whose id is `id`, in the document. */
const elementOf = (id: string) =>
  Effect.suspend(() => {
    const element = document.getElementById(id);
    return element === null
      ? Effect.fail(new Unshown({ reason: `There is no element with the id ${id}.` }))
      : Effect.succeed(element);
  });

/**
 * A game drawn by the page itself, as a Foldkit Subscription's Stream: `show` is given the session `resource` holds and the element whose id is `elementId`, and draws its game however the page draws, such as with a renderer of its own, for as long as the Stream runs; what it says goes on as Messages of the application's. If the session is not joined, though the Model says it is, as a Model restored after a reload does, `onNotJoined` says so, which puts the Model right so the game is drawn again once the session is joined; if it cannot be drawn, `onFailed` says why.
 */
export const run = <Message, Service, R>(options: {
  readonly resource: ManagedResource.ManagedResource<Session.Joined, Service>;
  readonly elementId: string;
  readonly show: (
    joined: Session.Joined,
    element: HTMLElement,
  ) => Stream.Stream<Message, Unshown, R>;
  readonly onNotJoined: () => Message;
  readonly onFailed: (reason: string) => Message;
}): Stream.Stream<Message, never, Service | R> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const maybeJoined = yield* Effect.option(options.resource.get);
      if (Option.isNone(maybeJoined)) {
        return Stream.make(options.onNotJoined());
      }
      const element = yield* elementOf(options.elementId);
      return options.show(maybeJoined.value, element);
    }).pipe(
      Effect.map(Stream.catch(({ reason }) => Stream.make(options.onFailed(reason)))),
      Effect.catch(({ reason }) => Effect.succeed(Stream.make(options.onFailed(reason)))),
    ),
  );

/**
 * A stage as a Foldkit Subscription's Stream: the game of the session `resource` holds, shown on the canvas whose id is `canvasId`, its mirror beside the canvas, for as long as the Stream runs. If the session is not joined, though the Model says it is, as a Model restored after a reload does, `onNotJoined` says so in a Message of the application's, which puts the Model right so the stage is shown again once the session is joined; if it cannot be shown otherwise, `onFailed` says why.
 */
export const stream = <Message, Service, R>(
  options: Options<R> & {
    readonly resource: ManagedResource.ManagedResource<Session.Joined, Service>;
    readonly canvasId: string;
    readonly onNotJoined: () => Message;
    readonly onFailed: (reason: string) => Message;
  },
): Stream.Stream<Message, never, Service | Exclude<R, Scope.Scope>> =>
  run({
    resource: options.resource,
    elementId: options.canvasId,
    onNotJoined: options.onNotJoined,
    onFailed: options.onFailed,
    show: (joined, element) =>
      Stream.unwrap(
        Effect.gen(function* () {
          if (!(element instanceof HTMLCanvasElement)) {
            return yield* new Unshown({
              reason: `There is no canvas with the id ${options.canvasId}.`,
            });
          }
          const viewport = yield* Viewport.make(element, options.viewport ?? {}).pipe(
            Effect.mapError(({ reason }) => new Unshown({ reason })),
          );
          yield* show(viewport, joined, {
            ...options,
            mirror: element.parentElement ?? document.body,
          });
          return Stream.never;
        }),
      ),
  });
