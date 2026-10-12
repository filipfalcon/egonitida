import { type Client, Pointing, type State } from '@lightocean/core';
import { Effect, Option, type Scope } from 'effect';
import * as Three from 'three/webgpu';
import type * as Drawing from '#src/Drawing.ts';
import type * as View from '#src/View.ts';

/**
 * The accessible mirror of a scene: every entity with a `Label` stands in a list of buttons that is not seen but is read out, each by its entity's label, in the order of the entities. Tab moves through them, the entity a button stands for is outlined in the scene while it has focus, and pressing it clicks the entity, as a click on it would; so whatever can be clicked can be reached and used without a pointer.
 */

export interface Mirror {
  /** Brings the list and the outline up to `frame`: what changed in the list is changed, nothing else. */
  readonly frame: (frame: Drawing.Frame) => Effect.Effect<void>;
}

/** Hidden from sight, never from a screen reader or the keyboard. */
const UNSEEN =
  'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0';

/** The mirror of what `views` draw, its list in `container` and its outline in `scene`, clicking for `client`, until the scope closes. */
export const make = (options: {
  readonly container: HTMLElement;
  readonly views: Pick<View.Views<never>, 'objectsOf'>;
  readonly scene: Three.Object3D;
  readonly client: Pick<Client.Client, 'act'>;
}): Effect.Effect<Mirror, never, Scope.Scope> =>
  Effect.gen(function* () {
    const run = Effect.runForkWith(yield* Effect.context<never>());
    const buttons = new Map<State.Entity, HTMLButtonElement>();

    const list = yield* Effect.acquireRelease(
      Effect.sync(() => {
        const made = document.createElement('ul');
        made.setAttribute('aria-label', 'Scene');
        made.style.cssText = UNSEEN;
        options.container.append(made);
        return made;
      }),
      (made) => Effect.sync(() => made.remove()),
    );
    const outline = yield* Effect.acquireRelease(
      Effect.sync(() => {
        const made = new Three.Box3Helper(new Three.Box3(), 0xffffff);
        made.name = 'lightocean:mirror';
        made.visible = false;
        options.scene.add(made);
        return made;
      }),
      (made) =>
        Effect.sync(() => {
          made.removeFromParent();
          made.dispose();
        }),
    );

    /** The button standing for `entity`, made the first time. */
    const buttonFor = (entity: State.Entity) => {
      const known = buttons.get(entity);
      if (known !== undefined) {
        return known;
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.addEventListener('click', () => {
        run(options.client.act(Pointing.Clicked, { entity }));
      });
      const item = document.createElement('li');
      item.append(button);
      buttons.set(entity, button);
      return button;
    };

    const frame = (drawn: Drawing.Frame) =>
      Effect.sync(() => {
        const labelled = drawn.query(Pointing.Label);
        const present = new Set(labelled.map(([entity]) => entity));
        for (const [entity, button] of buttons) {
          if (!present.has(entity)) {
            button.parentElement?.remove();
            buttons.delete(entity);
          }
        }
        labelled.forEach(([entity, { text }], index) => {
          const button = buttonFor(entity);
          if (button.textContent !== text) {
            button.textContent = text;
          }
          const item = button.parentElement;
          if (item !== null && list.children[index] !== item) {
            list.insertBefore(item, list.children[index] ?? null);
          }
        });

        // The entity whose button has focus now, read off the document rather than kept, so it is never out of date.
        const active = options.container.ownerDocument.activeElement;
        const focused = Option.fromNullishOr(
          [...buttons].find(([, button]) => button === active)?.[0],
        );
        const objects = Option.match(focused, {
          onNone: () => [],
          onSome: (entity) => options.views.objectsOf(entity),
        });
        outline.visible = objects.length > 0;
        if (outline.visible) {
          outline.box.makeEmpty();
          for (const object of objects) {
            outline.box.expandByObject(object);
          }
        }
      });

    return { frame };
  });
