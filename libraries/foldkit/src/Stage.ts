import { Clicking, Mirror, View, Viewport } from '@lightocean/client';
import { Data, Effect, Option, type Scope, Stream } from 'effect';
import type { ManagedResource } from 'foldkit';
import type * as World from '#src/World.ts';

/**
 * A world shown on a canvas in an application built on Foldkit: drawn through the game's views at every frame the display shows, played by a click on what is drawn, and mirrored as buttons for the keyboard and a screen reader. Foldkit keeps the canvas in its DOM, and says through a Mount when it is there; a Subscription shows the world on it while the application's Model has both the canvas and the world.
 */

/** How a stage is set: the game's views, and what else the scene holds, such as its camera and its lights. */
export interface Options<R> {
  readonly views: ReadonlyArray<View.View<R>>;
  /** Sets the scene up before the first frame, such as where the camera looks from and what lights it. */
  readonly setup?: ((viewport: Viewport.Viewport) => void) | undefined;
}

/** Shows `joined` on `viewport` through `options.views` until the scope closes: every click on the canvas acts on what is under it, and every labelled entity stands as a button in `mirror`. */
export const show = <R>(
  viewport: Viewport.Viewport,
  joined: World.Joined,
  options: Options<R> & { readonly mirror: HTMLElement },
): Effect.Effect<void, never, R | Scope.Scope> =>
  Effect.gen(function* () {
    const views = yield* View.make(options.views);
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
    yield* viewport.loop((seconds) =>
      Option.match(joined.drawing.frame(seconds), {
        onNone: () => Effect.void,
        onSome: (frame) => Effect.andThen(views.frame(frame), mirror.frame(frame)),
      }),
    );
  });

/** Why a stage could not be shown. */
export class Unshown extends Data.TaggedError('Unshown')<{ readonly reason: string }> {}

/** The canvas whose id is `id`, in the document. */
const canvasOf = (id: string) =>
  Effect.suspend(() => {
    const canvas = document.getElementById(id);
    return canvas instanceof HTMLCanvasElement
      ? Effect.succeed(canvas)
      : Effect.fail(new Unshown({ reason: `There is no canvas with the id ${id}.` }));
  });

/**
 * A stage as a Foldkit Subscription's Stream: the world `resource` holds, shown on the canvas whose id is `canvasId`, its mirror beside the canvas, for as long as the Stream runs; if it cannot be shown, `onFailed` says why in a Message of the application's.
 */
export const stream = <Message, Service, R>(
  options: Options<R> & {
    readonly resource: ManagedResource.ManagedResource<World.Joined, Service>;
    readonly canvasId: string;
    readonly onFailed: (reason: string) => Message;
  },
): Stream.Stream<Message, never, Service | Exclude<R, Scope.Scope>> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const joined = yield* options.resource.get.pipe(
        Effect.mapError(
          ({ resource }) => new Unshown({ reason: `The world ${resource} is not joined.` }),
        ),
      );
      const canvas = yield* canvasOf(options.canvasId);
      const viewport = yield* Viewport.make(canvas).pipe(
        Effect.mapError(({ reason }) => new Unshown({ reason })),
      );
      yield* show(viewport, joined, { ...options, mirror: canvas.parentElement ?? document.body });
      return Stream.never;
    }).pipe(Effect.catch(({ reason }) => Effect.succeed(Stream.make(options.onFailed(reason))))),
  );
