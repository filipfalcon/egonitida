import { type Scene, Viewport } from '@lightocean/engine';
import { Effect, Option, Queue, Schema, Stream } from 'effect';
import { Mount, Subscription } from 'foldkit';
import { Message, type Model, viewScene } from '#src/main.ts';

export const VIEWPORT_ID = 'viewport';

// The live viewports by the id of their canvas. The Mount owns each one's lifetime; the Subscription only draws into whichever is registered.
const viewports = new Map<string, Viewport.Viewport<Message>>();

// Starts the renderer on the canvas and keeps it for exactly as long as the canvas is in the DOM.
export const MountViewport = Mount.define('MountViewport', {
  args: { viewportId: Schema.String },
  messages: [Message.SucceededMountViewport, Message.FailedMountViewport],
  execute: ({ element, viewportId }) =>
    Effect.gen(function* () {
      if (!(element instanceof HTMLCanvasElement)) {
        return Message.FailedMountViewport({ reason: 'The viewport host is not a canvas.' });
      }
      const viewport = yield* Viewport.make<Message>(element);
      yield* Effect.acquireRelease(
        Effect.sync(() => viewports.set(viewportId, viewport)),
        () =>
          Effect.sync(() => {
            // A remount may already have claimed the id; only clear the slot while it still holds this viewport.
            if (viewports.get(viewportId) === viewport) {
              viewports.delete(viewportId);
            }
          }),
      );
      return Message.SucceededMountViewport();
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(Message.FailedMountViewport({ reason: error.reason })),
      ),
    ),
});

// The longest step one frame may take, so a frame after the tab was hidden does not jump motion forward by seconds.
const maximumFrameSeconds = 0.1;

/** Draws `readScene()` every animation frame, and turns clicks on the canvas into the Messages their picks produce. */
const drive = (
  viewport: Viewport.Viewport<Message>,
  readScene: () => Scene.Scene<Message>,
): Stream.Stream<Message> =>
  Stream.callback<Message>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const loop = { handle: 0, previous: performance.now() };
        const tick = (now: number) => {
          const seconds = Math.min((now - loop.previous) / 1000, maximumFrameSeconds);
          loop.previous = now;
          Effect.runSync(viewport.frame(readScene(), seconds));
          loop.handle = requestAnimationFrame(tick);
        };
        const click = (event: MouseEvent) => {
          Option.map(Effect.runSync(viewport.pick(event)), (message) =>
            Queue.offerUnsafe(queue, message),
          );
        };
        loop.handle = requestAnimationFrame(tick);
        viewport.canvas.addEventListener('click', click);
        return { loop, click };
      }),
      ({ loop, click }) =>
        Effect.sync(() => {
          cancelAnimationFrame(loop.handle);
          viewport.canvas.removeEventListener('click', click);
        }),
    ),
  );

export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
  viewport: entry(
    // The scene has no Schema of its own until the reflection step; it is read through `readDependencies`, never compared.
    { isViewportMounted: Schema.Boolean, scene: Schema.Any },
    {
      modelToDependencies: (model) => ({
        isViewportMounted: model.isViewportMounted,
        scene: viewScene(model),
      }),
      // The frame loop survives every Model change except the viewport coming or going; a new scene reaches it on the next frame.
      keepAliveEquivalence: (previous, next) =>
        previous.isViewportMounted === next.isViewportMounted,
      dependenciesToStream: ({ isViewportMounted }, readDependencies) =>
        Option.fromNullishOr(viewports.get(VIEWPORT_ID)).pipe(
          Option.filter(() => isViewportMounted),
          Option.match({
            onNone: () => Stream.empty,
            onSome: (viewport) =>
              drive(viewport, () => readDependencies().scene as Scene.Scene<Message>),
          }),
        ),
    },
  ),
}));
