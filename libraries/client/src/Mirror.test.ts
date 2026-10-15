// @vitest-environment happy-dom
import { describe, expect, it } from '@effect/vitest';
import { type Client, Component, Pointing, State } from '@nitida/core';
import { Effect, Option, Schema } from 'effect';
import * as Three from 'three/webgpu';
import * as Drawing from '#src/Drawing.ts';
import * as Mirror from '#src/Mirror.ts';
import * as Timeline from '#src/Timeline.ts';
import * as View from '#src/View.ts';

const Spot = Component.make('Spot', Schema.Struct({ x: Schema.Finite }), {
  owner: 'rules',
  network: 'server',
});

/** Everything at a spot, as a unit box there. */
const boxes = View.each([Spot], {
  acquire: () => Effect.succeed(new Three.Mesh(new Three.BoxGeometry(1, 1, 1))),
  draw: (box, held) => {
    box.position.x = held(Spot).x;
  },
});

const labelled = (x: number, text: string) => [Spot.of({ x }), Pointing.Label.of({ text })];

/** Two labelled boxes and one without a label, mirrored into a page, and the actions a client took. */
const mirrored = Effect.gen(function* () {
  const [one, lamp] = State.spawn(State.empty({ seed: 1 }), labelled(0, 'Lamp'));
  const [two] = State.spawn(one, [Spot.of({ x: 1 })]);
  const [state, chair] = State.spawn(two, labelled(3, 'Chair'));
  const views = yield* View.make([boxes]);
  const scene = new Three.Scene();
  const container = document.createElement('div');
  document.body.append(container);
  const acted: Array<unknown> = [];
  const client: Pick<Client.Client, 'act'> = {
    act: (action, value) =>
      Effect.sync(() => {
        acted.push(action.encode(value));
      }),
  };
  const mirror = yield* Mirror.make({ container, views, scene, client });
  const show = (shown: State.State, previous: Option.Option<Timeline.View>) =>
    Effect.gen(function* () {
      const frame = Drawing.frameOf(Timeline.still(shown), previous);
      yield* views.frame(frame);
      yield* mirror.frame(frame);
    });
  yield* show(state, Option.none());
  const buttons = () => [...container.querySelectorAll('button')];
  return { state, lamp, chair, scene, container, acted, show, buttons };
});

describe('the mirror of a scene', () => {
  it.effect('lists every labelled entity as a button read out by its label, in their order', () =>
    Effect.gen(function* () {
      const { container, buttons } = yield* mirrored;

      expect(buttons().map((button) => button.textContent)).toEqual(['Lamp', 'Chair']);
      expect(container.querySelector('ul')?.getAttribute('aria-label')).toBe('Scene');
    }),
  );

  it.effect('follows the state: a label that changes, and an entity that goes', () =>
    Effect.gen(function* () {
      const { state, lamp, chair, show, buttons } = yield* mirrored;
      const changing = State.draft(state);
      State.write(changing, chair, Pointing.Label, { text: 'Armchair' });
      State.despawnFrom(changing, lamp);
      const changed = State.finish(changing);

      yield* show(changed, Option.some(Timeline.still(state)));

      expect(buttons().map((button) => button.textContent)).toEqual(['Armchair']);
    }),
  );

  it.effect(
    'clicks the entity a button stands for when it is pressed, as a click on it would',
    () =>
      Effect.gen(function* () {
        const { chair, acted, buttons } = yield* mirrored;

        buttons()[1]?.click();
        yield* Effect.yieldNow;

        expect(acted).toEqual([{ _tag: 'Clicked', entity: chair }]);
      }),
  );

  it.effect('outlines the entity a button stands for while it has focus', () =>
    Effect.gen(function* () {
      const { state, scene, show, buttons } = yield* mirrored;
      const outline = () => scene.children.find((child) => child.name === 'nitida:mirror');

      buttons()[1]?.focus();
      yield* show(state, Option.some(Timeline.still(state)));
      const focused = outline();
      const shownWhileFocused = focused?.visible;
      const around =
        focused instanceof Three.Box3Helper
          ? Option.some(Math.round(focused.box.getCenter(new Three.Vector3()).x))
          : Option.none();
      buttons()[1]?.blur();
      yield* show(state, Option.some(Timeline.still(state)));

      expect(shownWhileFocused).toBe(true);
      expect(around).toEqual(Option.some(3));
      expect(outline()?.visible).toBe(false);
    }),
  );
});
