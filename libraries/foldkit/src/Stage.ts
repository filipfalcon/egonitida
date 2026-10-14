import {
  Clicking,
  Controls,
  type Devices,
  Hearing,
  Mirror,
  View,
  Viewport,
} from '@lightocean/client';
import { Data, Effect, Option, Schema, type Scope, Stream } from 'effect';
import type { ManagedResource } from 'foldkit';
import type * as Session from '#src/Session.ts';

/**
 * A game shown on a canvas in an application built on Foldkit: drawn through the game's views at every frame the display shows, played by a click on what is drawn, and mirrored as buttons for the keyboard and a screen reader. Foldkit keeps the canvas in its DOM, and says through a Mount when it is there; a Subscription shows the game on it while the application's Model has both the canvas and the session.
 */

/** How a stage is set: the game's views, the drawing's input they read, if they read one, and what else the scene holds, such as its camera and its lights. */
export type Options<
  R,
  M = undefined,
  V = M,
  B extends Controls.Bindings = Controls.Bindings,
> = Setting<R> & Drawn<R, M, V, B>;

/**
 * The views a stage draws, and the drawing's input, if they read one: what changes only how the game is drawn for this player. What the page keeps, as it keeps its Model, such as through whose eyes they look, `input` gives; what the player's devices change every frame, such as where they look, `played` plays on from it, once each frame the stage draws.
 */
export type Drawn<R, M, V, B extends Controls.Bindings> =
  | {
      readonly views: ReadonlyArray<View.View<R, undefined>>;
      readonly input?: undefined;
      readonly played?: undefined;
    }
  | {
      readonly views: ReadonlyArray<View.View<R, M>>;
      readonly input: () => M;
      readonly played?: undefined;
    }
  | {
      readonly views: ReadonlyArray<View.View<R, V>>;
      readonly input: () => M;
      readonly played: Played<M, V, B>;
    };

/**
 * The drawing's input played on from frame to frame with what the player does, which the page cannot keep in its Model as it changes every frame, such as where a stick turns them to look: from what `start` makes of what the page keeps when the stage is shown, each frame the stage draws, before its views draw, `next` gives the input after `before`, given what the page keeps, the controls `bindings` bind, the seconds the frame covers, and the devices as they are read then, for what no control says, such as where the mouse points. The stage hears the devices as `hearing` says, the mouse over its canvas unless told otherwise, and reads the controls every frame, whatever `next` makes of them, so a press is one only when it is new; `next` is a plain function, and the input holds only what the views read.
 */
export interface Played<M, V, B extends Controls.Bindings> {
  readonly hearing?: Hearing.Options | undefined;
  readonly bindings: B;
  readonly start: (fromPage: M) => V;
  readonly next: (
    fromPage: M,
    before: V,
    controls: Controls.Read<B>,
    seconds: number,
    devices: Devices.Reading,
  ) => V;
}

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

/** Shows `joined` on `viewport` through `options.views` until the scope closes, their rigs drawing its camera for the player who joined, from the drawing's input `options.input` gives, or `options.played` plays on from it, each frame, if they read one: every click on the canvas acts on what is under it, and every labelled entity stands as a button in `mirror`. */
export function show<const Given extends ReadonlyArray<View.View<unknown, undefined>>, A = never>(
  viewport: Viewport.Viewport,
  joined: Session.Joined,
  options: Setting<A> & {
    readonly views: Given;
    readonly input?: undefined;
    readonly played?: undefined;
    readonly mirror: HTMLElement;
  },
): Effect.Effect<void, never, View.NeedsOf<Given> | A | Scope.Scope>;
export function show<const Given extends ReadonlyArray<View.View<unknown, M>>, M, A = never>(
  viewport: Viewport.Viewport,
  joined: Session.Joined,
  options: Setting<A> & {
    readonly views: Given;
    readonly input: () => M;
    readonly played?: undefined;
    readonly mirror: HTMLElement;
  },
): Effect.Effect<void, never, View.NeedsOf<Given> | A | Scope.Scope>;
export function show<
  const Given extends ReadonlyArray<View.View<unknown, never>>,
  M,
  B extends Controls.Bindings,
  A = never,
>(
  viewport: Viewport.Viewport,
  joined: Session.Joined,
  options: Setting<A> & {
    readonly views: Given;
    readonly input: () => M;
    readonly played: Played<M, View.InputOf<Given>, B>;
    readonly mirror: HTMLElement;
  },
): Effect.Effect<void, never, View.NeedsOf<Given> | A | Scope.Scope>;
export function show<R, M, V, B extends Controls.Bindings>(
  viewport: Viewport.Viewport,
  joined: Session.Joined,
  options: Options<R, M, V, B> & { readonly mirror: HTMLElement },
): Effect.Effect<void, never, R | Scope.Scope> {
  return shownAs(viewport, joined, options);
}

/** `joined` shown on `viewport` as `options` draw it, needing what its views and what runs beside it need, together as `R`. */
const shownAs = <R, M, V, B extends Controls.Bindings>(
  viewport: Viewport.Viewport,
  joined: Session.Joined,
  options: Options<R, M, V, B> & { readonly mirror: HTMLElement },
): Effect.Effect<void, never, R | Scope.Scope> => {
  if (options.played !== undefined) {
    const { input, played } = options;
    return shown(viewport, joined, options, options.views, playedOn(input, played));
  }
  if (options.input !== undefined) {
    const { input } = options;
    return shown(viewport, joined, options, options.views, () =>
      Effect.succeed({ now: input, advance: () => {} }),
    );
  }
  return shown(viewport, joined, options, options.views, () =>
    Effect.succeed({ now: () => undefined, advance: () => {} }),
  );
};

/** The drawing's input as a stage keeps it: what it is `now`, and going on by a frame drawn, given the seconds the frame covers. */
interface Kept<V> {
  readonly now: () => V;
  readonly advance: (seconds: number) => void;
}

/** How a stage keeps the drawing's input, heard through what its viewport holds, until the scope closes. */
type Frames<V> = (viewport: Viewport.Viewport) => Effect.Effect<Kept<V>, never, Scope.Scope>;

/** The drawing's input `played` plays on from what `input` gives, with the controls read every frame from the devices heard on the window, the mouse over the viewport's canvas. */
const playedOn =
  <M, V, B extends Controls.Bindings>(input: () => M, played: Played<M, V, B>): Frames<V> =>
  (viewport) =>
    Effect.gen(function* () {
      const hearing = yield* Hearing.make(window, {
        ...played.hearing,
        keyboardAndMouse: Option.map(
          played.hearing?.keyboardAndMouse ?? Option.some({}),
          (heard) => ({ area: viewport.canvas, ...heard }),
        ),
      });
      const kept = { input: played.start(input()), controls: Controls.start(played.bindings) };
      return {
        now: () => kept.input,
        advance: (seconds) => {
          const devices = hearing.read();
          kept.controls = Controls.read(played.bindings, devices, kept.controls);
          kept.input = played.next(input(), kept.input, kept.controls, seconds, devices);
        },
      };
    });

/** `joined` shown on `viewport` through `views`, the drawing's input of each frame as `frames` works it out, before the views draw it. */
const shown = <R, V>(
  viewport: Viewport.Viewport,
  joined: Session.Joined,
  options: Setting<R> & { readonly mirror: HTMLElement },
  drawn: ReadonlyArray<View.View<R, V>>,
  frames: Frames<V>,
): Effect.Effect<void, never, R | Scope.Scope> =>
  Effect.gen(function* () {
    const input = yield* frames(viewport);
    const views = yield* View.make(
      drawn,
      Option.some({ camera: viewport.camera, player: joined.client.entity }),
      input.now,
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
        onSome: (frame) =>
          Effect.suspend(() => {
            // The input goes on once a frame drawn, before the views draw it.
            input.advance(seconds);
            return Effect.andThen(views.frame(frame), mirror.frame(frame));
          }),
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
    Showing<Message, Service> & {
      readonly views: Given;
      readonly input?: undefined;
      readonly played?: undefined;
    },
): Stream.Stream<Message, never, Service | Exclude<View.NeedsOf<Given> | A, Scope.Scope>>;
export function stream<
  Message,
  Service,
  const Given extends ReadonlyArray<View.View<unknown, M>>,
  M,
  A = never,
>(
  options: Setting<A> &
    Showing<Message, Service> & {
      readonly views: Given;
      readonly input: () => M;
      readonly played?: undefined;
    },
): Stream.Stream<Message, never, Service | Exclude<View.NeedsOf<Given> | A, Scope.Scope>>;
export function stream<
  Message,
  Service,
  const Given extends ReadonlyArray<View.View<unknown, never>>,
  M,
  B extends Controls.Bindings,
  A = never,
>(
  options: Setting<A> &
    Showing<Message, Service> & {
      readonly views: Given;
      readonly input: () => M;
      readonly played: Played<M, View.InputOf<Given>, B>;
    },
): Stream.Stream<Message, never, Service | Exclude<View.NeedsOf<Given> | A, Scope.Scope>>;
export function stream<Message, Service, R, M, V, B extends Controls.Bindings>(
  options: Options<R, M, V, B> & Showing<Message, Service>,
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
const streamed = <Message, Service, R, M, V, B extends Controls.Bindings>(
  options: Options<R, M, V, B> & Showing<Message, Service>,
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
          yield* shownAs(viewport, joined, {
            ...options,
            mirror: element.parentElement ?? document.body,
          });
          return Stream.never;
        }),
      ),
  });

/** What a stage's Subscription entry follows of the Model: whether the stage is shown, and the part of the drawing's input the page keeps. */
export interface Dependencies<M> {
  readonly isShown: boolean;
  readonly input: M;
}

/**
 * A stage as a Foldkit Subscription entry, which follows the drawing's input from the Model: shown while `shows` says so of the Model, its views reading every frame what `input.of` gives of the latest Model, such as through whose eyes the player looks, or what `played` plays on from it with what the player's devices do, such as where they look. A change of the input never shows the stage anew, so nothing its views built is built again; `input.schema` is what Foldkit tells the input's values apart by. Put in a record of `Subscription.make` as it is.
 */
export function entry<
  Model,
  Message,
  Service,
  const Given extends ReadonlyArray<View.View<unknown, M>>,
  M,
  A = never,
>(
  options: Setting<A> &
    Showing<Message, Service> & {
      readonly views: Given;
      readonly input: Followed<Model, M>;
      readonly played?: undefined;
      readonly shows: (model: Model) => boolean;
    },
): Entry<Model, Message, Service | Exclude<View.NeedsOf<Given> | A, Scope.Scope>, M>;
export function entry<
  Model,
  Message,
  Service,
  const Given extends ReadonlyArray<View.View<unknown, never>>,
  M,
  B extends Controls.Bindings,
  A = never,
>(
  options: Setting<A> &
    Showing<Message, Service> & {
      readonly views: Given;
      readonly input: Followed<Model, M>;
      readonly played: Played<M, View.InputOf<Given>, B>;
      readonly shows: (model: Model) => boolean;
    },
): Entry<Model, Message, Service | Exclude<View.NeedsOf<Given> | A, Scope.Scope>, M>;
export function entry<Model, Message, Service, R, M, V, B extends Controls.Bindings>(
  options: Setting<R> &
    Showing<Message, Service> & {
      readonly input: Followed<Model, M>;
      readonly shows: (model: Model) => boolean;
    } & (
      | { readonly views: ReadonlyArray<View.View<R, M>>; readonly played?: undefined }
      | { readonly views: ReadonlyArray<View.View<R, V>>; readonly played: Played<M, V, B> }
    ),
): Entry<Model, Message, Service | Exclude<R, Scope.Scope>, M> {
  const { input } = options;
  return {
    dependenciesSchema: Schema.Struct({ isShown: Schema.Boolean, input: input.schema }),
    modelToDependencies: (model) => ({
      isShown: options.shows(model),
      input: input.of(model),
    }),
    keepAliveEquivalence: (before, after) => before.isShown === after.isShown,
    dependenciesToStream: ({ isShown }, latest) => {
      if (!isShown) {
        return Stream.empty;
      }
      const fromModel = () => latest().input;
      return options.played === undefined
        ? streamed({ ...options, views: options.views, input: fromModel, played: undefined })
        : streamed({ ...options, views: options.views, input: fromModel, played: options.played });
    },
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
