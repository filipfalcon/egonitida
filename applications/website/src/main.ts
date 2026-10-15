import type { Session } from '@nitida/foldkit';
import { Effect, Option, Schema } from 'effect';
import { Command, ManagedResource, type Runtime, type Update } from 'foldkit';
import * as Dom from 'foldkit/dom';
import { defineMessageUnion } from 'foldkit/message';
import { UrlRequest, load, pushUrl } from 'foldkit/navigation';
import { modifyFields } from 'foldkit/struct';
import * as Url from 'foldkit/url';
import { AppRoute, urlToAppRoute } from '#src/route.ts';
import * as GlanceStage from '#src/glanceStage.ts';
import * as StatePress from '#src/statePress.ts';

/**
 * The engine's website: a home page that says what Nitida is, with an ocean of lights at its top that is a game on the engine, hosted in a worker and drawn on a canvas; and the engine's documentation, whose page of key terms explains a state with the state press. The pages are Foldkit's, and hold nothing of a game's state but whether it is shown.
 */

// MODEL

/** The ocean as far as the page has it: being joined, or joined, with the canvas it is shown on waiting to be in the page or mounted there. */
export const PageOcean = Schema.Union([
  Schema.TaggedStruct('Joining', {}),
  Schema.TaggedStruct('Joined', { canvas: Schema.Literals(['Waiting', 'Mounted']) }),
]);
export type PageOcean = typeof PageOcean.Type;

/** The website: the page its URL leads to, the URL, the ocean as far as the home page has it, what last went wrong showing it, and the stage of First Things First and the state press on the page of key terms. */
export const Model = Schema.Struct({
  route: AppRoute,
  url: Url.Url,
  ocean: PageOcean,
  maybeError: Schema.Option(Schema.String),
  glance: GlanceStage.Model,
  statePress: StatePress.Model,
});
export type Model = typeof Model.Type;

// MESSAGE

/** What happens on the website: a link clicked and the URL changed, what came of going there, the ocean joined, left, and shown, and what happens to the stage of First Things First and to the state press. */
export const Message = defineMessageUnion({
  ClickedLink: { request: UrlRequest },
  ChangedUrl: { url: Url.Url },
  CompletedNavigateInternal: {},
  CompletedLoadExternal: {},
  CompletedScrollToTop: {},
  CompletedScrollToAnchor: {},
  JoinedOcean: {},
  FoundOceanJoined: {},
  LeftOcean: {},
  FailedJoinOcean: { reason: Schema.String },
  MountedCanvas: {},
  FailedShowOcean: { reason: Schema.String },
  GotGlanceMessage: { message: GlanceStage.Message },
  GotStatePressMessage: { message: StatePress.Message },
});
export type Message = typeof Message.Type;

// RESOURCES

/** The ocean's session, joined while the page is open. */
export const OceanSession = ManagedResource.tag<Session.Joined>()('OceanSession');

/** What the website's Commands and Subscriptions reach: the ocean's session, and the press's. */
export type Services =
  | ManagedResource.ServiceOf<typeof OceanSession>
  | GlanceStage.Services
  | StatePress.Services;

// COMMANDS

/** Goes to `url` of the website itself, without loading the page again. */
export const NavigateInternal = Command.define('NavigateInternal', {
  args: { url: Schema.String },
  messages: [Message.CompletedNavigateInternal],
  execute: ({ url }) => pushUrl(url).pipe(Effect.as(Message.CompletedNavigateInternal())),
});

/** Loads `href` of another site, leaving this one. */
export const LoadExternal = Command.define('LoadExternal', {
  args: { href: Schema.String },
  messages: [Message.CompletedLoadExternal],
  execute: ({ href }) => load(href).pipe(Effect.as(Message.CompletedLoadExternal())),
});

/** Shows a page just gone to from its top. */
export const ScrollToTop = Command.define('ScrollToTop', {
  messages: [Message.CompletedScrollToTop],
  execute: Effect.sync(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    return Message.CompletedScrollToTop();
  }),
});

/** Shows the element `hash` names, once it is drawn, and gives it focus, so the keyboard goes on from there. */
export const ScrollToAnchor = Command.define('ScrollToAnchor', {
  args: { hash: Schema.String },
  messages: [Message.CompletedScrollToAnchor],
  execute: ({ hash }) =>
    Effect.gen(function* () {
      const target = `#${CSS.escape(hash)}`;
      yield* Dom.scrollIntoViewAfterPaint(target, { block: 'start' });
      yield* Dom.focus(target, { preventScroll: true, makeFocusable: true });
    }).pipe(Effect.ignore, Effect.as(Message.CompletedScrollToAnchor())),
});

// UPDATE

const failed = (model: Model, reason: string) =>
  modifyFields(model, { maybeError: () => Option.some(reason) });

/** The page after `message`. */
export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message, Services>>(message, {
    ClickedLink: ({ request }) =>
      UrlRequest.match<Update.Return<Model, Message, Services>>(request, {
        Internal: ({ url }) => ({
          model,
          commands: [NavigateInternal({ url: Url.toString(url) })],
        }),
        External: ({ href }) => ({ model, commands: [LoadExternal({ href })] }),
      }),
    // A hash shows the element it names; another page is shown from its top; the same page without a hash stays where it is.
    ChangedUrl: ({ url }) => ({
      model: modifyFields(model, { route: () => urlToAppRoute(url), url: () => url }),
      commands: Option.match(url.hash, {
        onNone: () => (url.pathname === model.url.pathname ? [] : [ScrollToTop()]),
        onSome: (hash) => [ScrollToAnchor({ hash })],
      }),
    }),
    CompletedNavigateInternal: () => ({ model }),
    CompletedLoadExternal: () => ({ model }),
    CompletedScrollToTop: () => ({ model }),
    CompletedScrollToAnchor: () => ({ model }),
    // Joined again while the Model already says so, as one restored after a reload does, the canvas in the page stays as it is. What went wrong while it was not joined is past.
    JoinedOcean: () => ({
      model: modifyFields(model, {
        ocean: (was) => (was._tag === 'Joined' ? was : { _tag: 'Joined', canvas: 'Waiting' }),
        maybeError: () => Option.none(),
      }),
    }),
    // Found joined while waiting for it, the ocean is joined, as when the stage found it not joined a moment before it was; found joined once the page has it, it changes nothing.
    FoundOceanJoined: () => ({
      model:
        model.ocean._tag === 'Joining'
          ? modifyFields(model, {
              ocean: () => ({ _tag: 'Joined', canvas: 'Waiting' }),
              maybeError: () => Option.none(),
            })
          : model,
    }),
    // The canvas goes with the ocean, so an ocean joined again waits for its own canvas.
    LeftOcean: () => ({
      model: modifyFields(model, { ocean: () => ({ _tag: 'Joining' }) }),
    }),
    FailedJoinOcean: ({ reason }) => ({ model: failed(model, reason) }),
    MountedCanvas: () => ({
      model:
        model.ocean._tag === 'Joined'
          ? modifyFields(model, { ocean: () => ({ _tag: 'Joined', canvas: 'Mounted' }) })
          : model,
    }),
    FailedShowOcean: ({ reason }) => ({ model: failed(model, reason) }),
    GotGlanceMessage: ({ message }) => {
      const staged = GlanceStage.update(model.glance, message);
      return {
        model: modifyFields(model, { glance: () => staged.model }),
        commands: Command.mapMessages(staged.commands, (inner) =>
          Message.GotGlanceMessage({ message: inner }),
        ),
      };
    },
    GotStatePressMessage: ({ message }) => {
      const pressed = StatePress.update(model.statePress, message);
      return {
        model: modifyFields(model, { statePress: () => pressed.model }),
        commands: Command.mapMessages(pressed.commands, (inner) =>
          Message.GotStatePressMessage({ message: inner }),
        ),
      };
    },
  });

// INIT

/** The website as it opens at `url`: at the page it leads to, joining the ocean. */
export const initialModelAt = (url: Url.Url): Model => ({
  route: urlToAppRoute(url),
  url,
  ocean: { _tag: 'Joining' },
  maybeError: Option.none(),
  glance: GlanceStage.initialModel,
  statePress: StatePress.initialModel,
});

/** The website as it opens at `url`. */
export const init: Runtime.RoutingApplicationInit<Model, Message> = (url) => ({
  model: initialModelAt(url),
});
