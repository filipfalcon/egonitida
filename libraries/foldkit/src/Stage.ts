import { Clicking, Mirror, View, Viewport } from '@lightocean/client';
import { Data, Effect, Option, Schema, type Scope, Stream } from 'effect';
import type { ManagedResource } from 'foldkit';
import type * as Session from '#src/Session.ts';

/**
 * A game shown on a canvas in an application built on Foldkit: drawn through the game's views at every frame the display shows, played by a click on what is drawn, and mirrored as buttons for the keyboard and a screen reader. Foldkit keeps the canvas in its DOM, and says through a Mount when it is there; a Subscription shows the game on it while the application's Model has both the canvas and the session.
 */

/** How a stage is set: the game's views, the drawing's input they read, if they read one, and what else the scene holds, such as its camera and its lights. */
export type Options<R, V = undefined> = Setting<R> & Drawn<R, V>;

/**
 * The views a stage draws, and the drawing's input, if they read one: what changes only how the game is drawn for this player, such as through whose eyes they look, which the page keeps, as it keeps its Model, and the views read every frame.
 */
export type Drawn<R, V> =
  | { readonly views: ReadonlyArray<View.View<R, undefined>>; readonly input?: undefined }
  | { readonly views: ReadonlyArray<View.View<R, V>>; readonly input: () => V };

/** What else a stage's scene holds and runs beside it, apart from its views. */
export interface Setting<R> {
  /** How the viewport draws, as bare Three.js does unless told otherwise, such as through a preset like `Viewport.sharp`. */
  readonly viewport?: Viewport.Options | undefined;
  /** Sets the scene up before the first frame, such as where the camera looks from and what lights it. */
  readonly setup?: ((viewport: Viewport.Viewport) => void) | undefined;
  /** What runs beside the stage while it is shown, given its viewport, such as the devtools' `Page.serve`, which captures the canvas for an agent to see what is drawn. */
  readonly alongside?:
    | ((viewport: Viewport.Viewport) => Effect.Effect<void, never, R | Scope.Scope>)
    | undefined;
}

/** Shows `joined` on `viewport` through `options.views` until the scope closes, their rigs drawing its camera for the player who joined, from the drawing's input `options.input` gives each frame, if they read one: every click on the canvas acts on what is under it, and every labelled entity stands as a button in `mirror`. */
export function show<const Given extends ReadonlyArray<View.View<unknown, undefined>>, A = never>(
  viewport: Viewport.Viewport,
  joined: Session.Joined,
  options: Setting<A> & {
    readonly views: Given;
    readonly input?: undefined;
    readonly mirror: HTMLElement;
  },
): Effect.Effect<void, never, View.NeedsOf<Given> | A | Scope.Scope>;
export function show<const Given extends ReadonlyArray<View.View<unknown, V>>, V, A = never>(
  viewport: Viewport.Viewport,
  joined: Session.Joined,
  options: Setting<A> & {
    readonly views: Given;
    readonly input: () => V;
    readonly mirror: HTMLElement;
  },
): Effect.Effect<void, never, View.NeedsOf<Given> | A | Scope.Scope>;
export function show<R, V>(
  viewport: Viewport.Viewport,
  joined: Session.Joined,
  options: Options<R, V> & { readonly mirror: HTMLElement },
): Effect.Effect<void, never, R | Scope.Scope> {
  return shown(viewport, joined, options);
}

/** `joined` shown on `viewport`, needing what its views and what runs beside it need, together as `R`. */
const shown = <R, V>(
  viewport: Viewport.Viewport,
  joined: Session.Joined,
  options: Options<R, V> & { readonly mirror: HTMLElement },
): Effect.Effect<void, never, R | Scope.Scope> =>
  Effect.gen(function* () {
    const looking = Option.some({ camera: viewport.camera, player: joined.client.entity });
    const views = yield* options.input === undefined
      ? View.make(options.views, looking)
      : View.make(options.views, looking, options.input);
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
export function stream<
  Message,
  Service,
  const Given extends ReadonlyArray<View.View<unknown, undefined>>,
  A = never,
>(
  options: Setting<A> &
    Showing<Message, Service> & { readonly views: Given; readonly input?: undefined },
): Stream.Stream<Message, never, Service | Exclude<View.NeedsOf<Given> | A, Scope.Scope>>;
export function stream<
  Message,
  Service,
  const Given extends ReadonlyArray<View.View<unknown, V>>,
  V,
  A = never,
>(
  options: Setting<A> &
    Showing<Message, Service> & { readonly views: Given; readonly input: () => V },
): Stream.Stream<Message, never, Service | Exclude<View.NeedsOf<Given> | A, Scope.Scope>>;
export function stream<Message, Service, R, V>(
  options: Options<R, V> & Showing<Message, Service>,
): Stream.Stream<Message, never, Service | Exclude<R, Scope.Scope>> {
  return streamed(options);
}

/** Where a stage is shown, and what it says of being shown, in Messages of the application's. */
export interface Showing<Message, Service> {
  readonly resource: ManagedResource.ManagedResource<Session.Joined, Service>;
  readonly canvasId: string;
  readonly onNotJoined: () => Message;
  readonly onFailed: (reason: string) => Message;
}

/** A stage's Stream, needing what its views and what runs beside it need, together as `R`. */
const streamed = <Message, Service, R, V>(
  options: Options<R, V> & Showing<Message, Service>,
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
          yield* shown(viewport, joined, {
            ...options,
            mirror: element.parentElement ?? document.body,
          });
          return Stream.never;
        }),
      ),
  });

/** What a stage's Subscription entry follows of the Model: whether the stage is shown, and the drawing's input. */
export interface Dependencies<V> {
  readonly isShown: boolean;
  readonly input: V;
}

/**
 * A stage as a Foldkit Subscription entry, which follows the drawing's input from the Model: shown while `shows` says so of the Model, its views reading every frame what `input.of` gives of the latest Model, such as through whose eyes the player looks. A change of the input never shows the stage anew, so nothing its views built is built again; `input.schema` is what Foldkit tells the input's values apart by. Put in a record of `Subscription.make` as it is.
 */
export function entry<
  Model,
  Message,
  Service,
  const Given extends ReadonlyArray<View.View<unknown, V>>,
  V,
  A = never,
>(
  options: Setting<A> &
    Showing<Message, Service> & {
      readonly views: Given;
      readonly input: Followed<Model, V>;
      readonly shows: (model: Model) => boolean;
    },
): Entry<Model, Message, Service | Exclude<View.NeedsOf<Given> | A, Scope.Scope>, V>;
export function entry<Model, Message, Service, R, V>(
  options: Setting<R> &
    Showing<Message, Service> & {
      readonly views: ReadonlyArray<View.View<R, V>>;
      readonly input: Followed<Model, V>;
      readonly shows: (model: Model) => boolean;
    },
): Entry<Model, Message, Service | Exclude<R, Scope.Scope>, V> {
  return {
    dependenciesSchema: Schema.Struct({ isShown: Schema.Boolean, input: options.input.schema }),
    modelToDependencies: (model) => ({
      isShown: options.shows(model),
      input: options.input.of(model),
    }),
    keepAliveEquivalence: (before, after) => before.isShown === after.isShown,
    dependenciesToStream: ({ isShown }, latest) =>
      isShown ? streamed({ ...options, input: () => latest().input }) : Stream.empty,
  };
}

/** The drawing's input as a stage's entry follows it from the Model: what `of` gives of it, told apart by `schema`. */
export interface Followed<Model, V> {
  readonly schema: Schema.Codec<V>;
  readonly of: (model: Model) => V;
}

/** A stage's Subscription entry, in the shape Foldkit's `Subscription.make` takes, its Stream needing `R`. */
export interface Entry<Model, Message, R, V> {
  readonly dependenciesSchema: Schema.Struct<{
    readonly isShown: Schema.Boolean;
    readonly input: Schema.Codec<V>;
  }>;
  readonly modelToDependencies: (model: Model) => Dependencies<V>;
  readonly keepAliveEquivalence: (before: Dependencies<V>, after: Dependencies<V>) => boolean;
  readonly dependenciesToStream: (
    dependencies: Dependencies<V>,
    latest: () => Dependencies<V>,
  ) => Stream.Stream<Message, never, R>;
}
