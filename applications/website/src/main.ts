import type { World } from '@lightocean/foldkit';
import { Option, Schema } from 'effect';
import { ManagedResource, type Runtime, type Update } from 'foldkit';
import { defineMessageUnion } from 'foldkit/message';
import { modifyFields } from 'foldkit/struct';

/**
 * The engine's website: one page that says what LightOcean is, with an ocean of lights at its top that is a world on the engine, hosted in a worker and drawn on a canvas. The page around it is Foldkit's, and holds nothing of the world but whether it is shown.
 */

// MODEL

/** The ocean as far as the page has it: being joined, or joined, with the canvas it is shown on waiting to be in the page or mounted there. */
export const OceanState = Schema.Union([
  Schema.TaggedStruct('Joining', {}),
  Schema.TaggedStruct('Joined', { canvas: Schema.Literals(['Waiting', 'Mounted']) }),
]);
export type OceanState = typeof OceanState.Type;

/** The website's page: the ocean as far as it has it, and what last went wrong showing it. */
export const Model = Schema.Struct({
  ocean: OceanState,
  maybeError: Schema.Option(Schema.String),
});
export type Model = typeof Model.Type;

// MESSAGE

/** What happens on the page: the ocean joined, left, and shown. */
export const Message = defineMessageUnion({
  JoinedOcean: {},
  FoundOceanJoined: {},
  LeftOcean: {},
  FailedJoinOcean: { reason: Schema.String },
  MountedCanvas: {},
  FailedShowOcean: { reason: Schema.String },
});
export type Message = typeof Message.Type;

// RESOURCES

/** The ocean's world, joined while the page is open. */
export const OceanWorld = ManagedResource.tag<World.Joined>()('OceanWorld');

/** What the website's Subscriptions reach: the ocean's world. */
export type Services = ManagedResource.ServiceOf<typeof OceanWorld>;

// UPDATE

const failed = (model: Model, reason: string) =>
  modifyFields(model, { maybeError: () => Option.some(reason) });

/** The page after `message`. */
export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message, Services>>(message, {
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
  });

// INIT

/** The page as it opens: joining the ocean. */
export const initialModel: Model = { ocean: { _tag: 'Joining' }, maybeError: Option.none() };

/** The page as it opens. */
export const init: Runtime.ApplicationInit<Model, Message> = () => ({ model: initialModel });
