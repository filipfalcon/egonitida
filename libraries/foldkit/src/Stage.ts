import {
  Clicking,
  Controls,
  type Devices,
  Hearing,
  Mirror,
  View,
  Viewport,
} from '@egonitida/client';
import { Data, type Duration, Effect, Option, Queue, Schema, type Scope, Stream } from 'effect';
import type { Action, Client, Component, Input } from '@egonitida/core';
import type { ManagedResource } from 'foldkit';
import type * as Session from '#src/Session.ts';

/**
 * A game shown on a canvas in an application built on Foldkit: drawn through the game's views at every frame the display shows, played by a click on what is drawn, and mirrored as buttons for the keyboard and a screen reader. Foldkit keeps the canvas in its DOM, and says through a Mount when it is there; a Subscription shows the game on it while the application's Model has both the canvas and the session.
 */

/** How a stage is set: the game's views, the drawing's input they read, if they read one, and what else the scene holds, such as its camera and its lights. */
export type Options<
  R,
  M = undefined,
  P = M,
  V = M,
  B extends Controls.Bindings = Controls.Bindings,
  T = never,
> = Setting<R> & Drawn<R, M, P, V, B, T>;

/**
 * The views a stage draws, and the drawing's input, if they read one: what changes only how the game is drawn for this player. What the page keeps, as it keeps its Model, such as through whose eyes they look, `input` gives; what the player's devices change every frame, such as where they look, `played` plays on, once each frame the stage draws, and gives the views with what the page keeps.
 */
export type Drawn<R, M, P, V, B extends Controls.Bindings, T = never> =
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
      readonly played: Played<M, P, V, B, T>;
    };

/**
 * What the stage plays on from frame to frame with what the player does, which the page cannot keep in its Model as it changes every frame, such as where a stick turns them to look: from what `start` makes of what the page keeps when the stage is shown, each frame the stage draws, before its views draw, `next` plays it on from `before`, given what the page keeps, the controls `bindings` bind, the seconds the frame covers, and the devices as they are read then, for what no control says, such as where the mouse points. The stage keeps what it plays on, what the controls must remember with it, such as how long since a stick was last touched; `drawing` gives the views only what they read of it, with what the page keeps, as the drawing's input. The stage hears the devices as `hearing` says, the mouse over its canvas unless told otherwise, and reads the controls every frame, whatever `next` makes of them, so a press is one only when it is new; `next` and `drawing` are plain functions.
 */
export interface Played<M, P, V, B extends Controls.Bindings, T = never> {
  readonly hearing?: Hearing.Options | undefined;
  readonly bindings: B;
  readonly start: (fromPage: M) => P;
  readonly next: (
    fromPage: M,
    before: P,
    controls: Controls.Read<B>,
    seconds: number,
    devices: Devices.Reading,
  ) => P;
  /** The drawing's input of a frame: what the views read of what the page keeps and what the stage played on. */
  readonly drawing: (fromPage: M, played: P) => V;
  /** What the player demands of the game in each frame drawn, from what the page keeps, what the stage played on in it, and the controls: such as where they head, the stick turned by where the camera faces. The stage sends them, before its views draw. */
  readonly demands?:
    | ((fromPage: M, played: P, controls: Controls.Read<B>) => ReadonlyArray<Component.Instance>)
    | undefined;
  /** What the player did in each frame drawn, as their actions, from what the page keeps, what the stage played on in it, and the controls: such as a press of a button throwing a punch, each made by `acted`. The stage sends them, after the frame's demands, before its views draw. */
  readonly actions?:
    | ((fromPage: M, played: P, controls: Controls.Read<B>) => ReadonlyArray<Acted>)
    | undefined;
  /** What the player's presses come to on the page in each frame drawn, as Messages of the application's, from what the page keeps, what the stage played on in it, and the controls: such as a press of the directional pad choosing the next item of a menu the page shows. The stage tells them to the page, which decides what they change, as it decides a click. */
  readonly messages?:
    | ((fromPage: M, played: P, controls: Controls.Read<B>) => ReadonlyArray<T>)
    | undefined;
  /** What the page is told when the player takes up another kind of device than they used before, a pad after the keyboard and mouse or back, as a Message of the application's: for the page to hide the cursor while they play with a pad, or show the buttons of the device in their hands. The first device they use is told too. */
  readonly inHand?: ((kind: Controls.Kind) => T) | undefined;
}

/** Something the player did, as a stage sends it to the game: an action and what it carries, made by `acted`. */
export interface Acted {
  readonly sendBy: (client: Client.Client) => Effect.Effect<void>;
}

/** That the player did `action`, carrying `value`, for a stage to send the game as their action. */
export const acted = <Sent>(
  action: Action.Action<string, Sent, Input.Action>,
  value: Sent,
): Acted => ({ sendBy: (client) => client.act(action, value) });

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

/** Shows `joined` on `viewport` through `options.views` until the scope closes, their rigs drawing its camera for the player who joined, from the drawing's input `options.input` gives, or `options.played` plays on from it, each frame, if they read one: every click on the canvas acts on what is under it, and every labelled entity stands as a button in `mirror`. What the player's presses come to, as `played.messages` says, goes to `tell`. */
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
  P,
  B extends Controls.Bindings,
  A = never,
>(
  viewport: Viewport.Viewport,
  joined: Session.Joined,
  options: Setting<A> & {
    readonly views: Given;
    readonly input: () => M;
    readonly played: Played<M, P, View.InputOf<Given>, B>;
    readonly mirror: HTMLElement;
  },
): Effect.Effect<void, never, View.NeedsOf<Given> | A | Scope.Scope>;
export function show<
  const Given extends ReadonlyArray<View.View<unknown, never>>,
  M,
  P,
  B extends Controls.Bindings,
  T,
  A = never,
>(
  viewport: Viewport.Viewport,
  joined: Session.Joined,
  options: Setting<A> & {
    readonly views: Given;
    readonly input: () => M;
    readonly played: Played<M, P, View.InputOf<Given>, B, T>;
    readonly mirror: HTMLElement;
    readonly tell: (message: T) => Effect.Effect<void>;
  },
): Effect.Effect<void, never, View.NeedsOf<Given> | A | Scope.Scope>;
export function show<R, M, P, V, B extends Controls.Bindings, T>(
  viewport: Viewport.Viewport,
  joined: Session.Joined,
  options: Options<R, M, P, V, B, T> & {
    readonly mirror: HTMLElement;
    readonly tell?: ((message: T) => Effect.Effect<void>) | undefined;
  },
): Effect.Effect<void, never, R | Scope.Scope> {
  const { tell } = options;
  return shownAs(viewport, joined, options, (told) =>
    tell === undefined ? Effect.void : Effect.forEach(told, tell, { discard: true }),
  );
}

/** `joined` shown on `viewport` as `options` draw it, needing what its views and what runs beside it need, together as `R`. */
const shownAs = <R, M, P, V, B extends Controls.Bindings, T>(
  viewport: Viewport.Viewport,
  joined: Session.Joined,
  options: Options<R, M, P, V, B, T> & { readonly mirror: HTMLElement },
  tell: (told: ReadonlyArray<T>) => Effect.Effect<void>,
): Effect.Effect<void, never, R | Scope.Scope> => {
  if (options.played !== undefined) {
    const { input, played } = options;
    return shown(viewport, joined, options, options.views, playedOn(input, played), tell);
  }
  if (options.input !== undefined) {
    const { input } = options;
    return shown(
      viewport,
      joined,
      options,
      options.views,
      () => Effect.succeed({ now: input, advance: () => nothingPlayed }),
      tell,
    );
  }
  return shown(
    viewport,
    joined,
    options,
    options.views,
    () => Effect.succeed({ now: () => undefined, advance: () => nothingPlayed }),
    tell,
  );
};

/** A frame in which the player played nothing: no demands, and nothing to tell the page. */
const nothingPlayed: Advanced<never> = { demanded: [], done: [], told: [] };

/** What a frame drawn came to: what the player demands in it, what they did, and what their presses tell the page. */
interface Advanced<T> {
  readonly demanded: ReadonlyArray<Component.Instance>;
  readonly done: ReadonlyArray<Acted>;
  readonly told: ReadonlyArray<T>;
}

/** The drawing's input as a stage keeps it: what it is `now`, and going on by a frame drawn, given the seconds the frame covers, which gives what the frame came to. */
interface Kept<V, T> {
  readonly now: () => V;
  readonly advance: (seconds: number) => Advanced<T>;
}

/** How a stage keeps the drawing's input, heard through what its viewport holds, until the scope closes. */
type Frames<V, T> = (viewport: Viewport.Viewport) => Effect.Effect<Kept<V, T>, never, Scope.Scope>;

/** The drawing's input of each frame, from what `input` gives and what `played` plays on, with the controls read every frame from the devices heard on the window, the mouse over the viewport's canvas. */
const playedOn =
  <M, P, V, B extends Controls.Bindings, T>(
    input: () => M,
    played: Played<M, P, V, B, T>,
  ): Frames<V, T> =>
  (viewport) =>
    Effect.gen(function* () {
      const hearing = yield* Hearing.make(window, {
        ...played.hearing,
        keyboardAndMouse: Option.map(
          played.hearing?.keyboardAndMouse ?? Option.some({}),
          (heard) => ({ area: viewport.canvas, ...heard }),
        ),
      });
      const kept = { played: played.start(input()), controls: Controls.start(played.bindings) };
      return {
        now: () => played.drawing(input(), kept.played),
        advance: (seconds) => {
          const devices = hearing.read();
          const fromPage = input();
          const before = kept.controls;
          kept.controls = Controls.read(played.bindings, devices, before);
          kept.played = played.next(fromPage, kept.played, kept.controls, seconds, devices);
          const { inHand } = played;
          const takenUp =
            inHand === undefined
              ? []
              : Option.match(Controls.takenUp(before, kept.controls), {
                  onNone: () => [],
                  onSome: (kind) => [inHand(kind)],
                });
          return {
            demanded: played.demands?.(fromPage, kept.played, kept.controls) ?? [],
            done: played.actions?.(fromPage, kept.played, kept.controls) ?? [],
            told: [...takenUp, ...(played.messages?.(fromPage, kept.played, kept.controls) ?? [])],
          };
        },
      };
    });

/** `joined` shown on `viewport` through `views`, the drawing's input of each frame as `frames` works it out, before the views draw it, and what each frame came to sent to the game or told the page through `tell`. */
const shown = <R, V, T>(
  viewport: Viewport.Viewport,
  joined: Session.Joined,
  options: Setting<R> & { readonly mirror: HTMLElement },
  drawn: ReadonlyArray<View.View<R, V>>,
  frames: Frames<V, T>,
  tell: (told: ReadonlyArray<T>) => Effect.Effect<void>,
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
            // The input goes on once a frame drawn, what the player demands in it and what they did are sent, and what their presses come to is told the page, before the views draw it.
            const { demanded, done, told } = input.advance(seconds);
            return Effect.andThen(
              Effect.all(
                [
                  demanded.length === 0 ? Effect.void : joined.client.send(demanded),
                  Effect.forEach(done, ({ sendBy }) => sendBy(joined.client), { discard: true }),
                  told.length === 0 ? Effect.void : tell(told),
                ],
                { discard: true },
              ),
              Effect.andThen(views.frame(frame), mirror.frame(frame)),
            );
          }),
      }).pipe(Effect.andThen(viewport.render)),
    );
  });

/** How a stage plays, as it measures it: how many frames it drew in the last second, and how many milliseconds the way to the host and back took, if the host answered in time. A page keeps it in its Model and shows it as it likes, such as in a corner over the canvas while debugging. */
export const Measured = Schema.Struct({
  framesPerSecond: Schema.Finite,
  latencyMillis: Schema.Option(Schema.Finite),
});
export type Measured = typeof Measured.Type;

/** How often a stage measures how it plays, unless told otherwise. */
const MEASURED_EVERY: Duration.Input = '500 millis';

/**
 * How a stage on `viewport` showing the game `client` joined plays, measured once `every` while, from then on: the frames the viewport drew in the last second, and the client's ping, given up on if the host has not answered it within the while, as one lost on the way never is.
 */
export const measuring = (
  viewport: Pick<Viewport.Viewport, 'framesPerSecond'>,
  client: Pick<Client.Client, 'ping'>,
  every: Duration.Input = MEASURED_EVERY,
): Stream.Stream<Measured> =>
  Stream.fromEffectRepeat(
    Effect.gen(function* () {
      const [latencyMillis] = yield* Effect.all(
        [Effect.timeoutOption(client.ping, every), Effect.sleep(every)],
        { concurrency: 'unbounded' },
      );
      return { framesPerSecond: yield* viewport.framesPerSecond, latencyMillis };
    }),
  );

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
  P,
  B extends Controls.Bindings,
  A = never,
>(
  options: Setting<A> &
    Showing<Message, Service> & {
      readonly views: Given;
      readonly input: () => M;
      readonly played: Played<M, P, View.InputOf<Given>, B, Message>;
    },
): Stream.Stream<Message, never, Service | Exclude<View.NeedsOf<Given> | A, Scope.Scope>>;
export function stream<Message, Service, R, M, P, V, B extends Controls.Bindings>(
  options: Options<R, M, P, V, B, Message> & Showing<Message, Service>,
): Stream.Stream<Message, never, Service | Exclude<R, Scope.Scope>> {
  return streamed(options);
}

/** Where a stage is shown, and what it says of being shown, in Messages of the application's: and, if the page asks, how it plays, measured once `every` while, half a second unless told otherwise, as `onMeasured` says. */
export interface Showing<Message, Service> {
  readonly resource: ManagedResource.ManagedResource<Session.Joined, Service>;
  readonly canvasId: string;
  readonly onNotJoined: () => Message;
  readonly onFailed: (reason: string) => Message;
  readonly measured?:
    | {
        readonly onMeasured: (measured: Measured) => Message;
        readonly every?: Duration.Input | undefined;
      }
    | undefined;
}

/** A stage's Stream, needing what its views and what runs beside it need, together as `R`. */
const streamed = <Message, Service, R, M, P, V, B extends Controls.Bindings>(
  options: Options<R, M, P, V, B, Message> & Showing<Message, Service>,
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
          const told = yield* Queue.unbounded<Message>();
          yield* shownAs(
            viewport,
            joined,
            { ...options, mirror: element.parentElement ?? document.body },
            (messages) => Queue.offerAll(told, messages).pipe(Effect.asVoid),
          );
          const { measured } = options;
          return measured === undefined
            ? Stream.fromQueue(told)
            : Stream.merge(
                Stream.fromQueue(told),
                measuring(viewport, joined.client, measured.every).pipe(
                  Stream.map(measured.onMeasured),
                ),
              );
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
  P,
  B extends Controls.Bindings,
  A = never,
>(
  options: Setting<A> &
    Showing<Message, Service> & {
      readonly views: Given;
      readonly input: Followed<Model, M>;
      readonly played: Played<M, P, View.InputOf<Given>, B, Message>;
      readonly shows: (model: Model) => boolean;
    },
): Entry<Model, Message, Service | Exclude<View.NeedsOf<Given> | A, Scope.Scope>, M>;
export function entry<Model, Message, Service, R, M, P, V, B extends Controls.Bindings>(
  options: Setting<R> &
    Showing<Message, Service> & {
      readonly input: Followed<Model, M>;
      readonly shows: (model: Model) => boolean;
    } & (
      | { readonly views: ReadonlyArray<View.View<R, M>>; readonly played?: undefined }
      | {
          readonly views: ReadonlyArray<View.View<R, V>>;
          readonly played: Played<M, P, V, B, Message>;
        }
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
