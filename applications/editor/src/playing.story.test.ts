import { describe, expect, it } from '@effect/vitest';
import { Pointing, Story, State } from '@nitida/core';
import { Option } from 'effect';
import * as Editing from '#src/editing.ts';
import * as Objects from '#src/objects.ts';
import * as Playing from '#src/playing.ts';

/** A sphere, and a box that, when clicked, turns green, lifts the sphere twice, and spins faster; and a player who clicks. */
const [withSphere, sphere] = State.spawn(
  State.empty({ seed: 1 }),
  Objects.objectOf('Sphere', 1, 'Sphere 2'),
);
const reactions: ReadonlyArray<Objects.Reaction> = [
  { target: Objects.itself, change: { _tag: 'Recolour', hex: 0x00ff00 } },
  { target: { _tag: 'Other', entity: sphere }, change: { _tag: 'MoveBy', offset: [0, 1, 0] } },
  { target: { _tag: 'Other', entity: sphere }, change: { _tag: 'MoveBy', offset: [0, 1, 0] } },
  { target: Objects.itself, change: { _tag: 'SetSpin', speed: 3 } },
];
const [withBox, box] = State.spawn(withSphere, [
  ...Objects.objectOf('Box', 0, 'Box 1').filter(({ component }) => component !== Objects.Behaviour),
  Objects.Behaviour.of({ reactions }),
]);
const [state, player] = State.spawn(withBox, []);
const given = Story.given(state, { box, sphere, player });

describe('a document playing', () => {
  it("carries out a clicked object's reactions in order, on itself or another", () => {
    const [x, , z] = Objects.placeOf(1);
    Story.story(
      Playing.game,
      given,
      Story.act('player', Pointing.Clicked, { entity: box }),
      Story.step(),
      Story.expectEqual('box', Objects.Colour, { hex: 0x00ff00 }),
      Story.expectEqual('box', Objects.Spin, { speed: 3 }),
      Story.expect('sphere', Objects.Transform, ({ position }) => {
        expect(position).toEqual([x, 2, z]);
      }),
    );
  });

  it('changes nothing for a reaction whose target is gone', () => {
    Story.story(
      Playing.game,
      Story.given(State.despawn(state, sphere), { box, player }),
      Story.act('player', Pointing.Clicked, { entity: box }),
      Story.step(),
      Story.expectEqual('box', Objects.Colour, { hex: 0x00ff00 }),
      Story.expectState((after) => {
        expect(State.entities(after)).not.toContain(sphere);
      }),
    );
  });

  it('turns every object as time goes on, at its spin, and on from where it was when the spin changes', () => {
    Story.story(
      Playing.game,
      given,
      Story.seconds(1),
      Story.expect('box', Objects.Turn, ({ angle }) => {
        expect(angle).toBeCloseTo(0.5);
      }),
      Story.act('player', Pointing.Clicked, { entity: box }),
      Story.seconds(1),
      Story.expect('box', Objects.Turn, ({ angle }) => {
        expect(angle).toBeCloseTo(3.5, 0);
      }),
    );
  });

  it('starts from the document as it is edited, its objects where they were, without what only editing keeps', () => {
    const edited = Story.story(
      Editing.game,
      Story.given(Editing.joined.state, { editor: Editing.joined.editor }),
      Story.act('editor', Pointing.Clicked, { entity: Editing.box }),
      Story.act('editor', Editing.AddedReaction, { entity: Editing.box }),
      Story.step(),
    ).state;

    const played = Playing.fromOpening(Playing.opening(edited));

    expect(Option.map(played, (state) => State.entities(state))).toEqual(
      Option.some([Editing.box, Editing.sphere]),
    );
    expect(
      Option.flatMap(played, (state) => State.get(state, Editing.box, Objects.Behaviour)),
    ).toEqual(State.get(edited, Editing.box, Objects.Behaviour));
    expect(
      Option.flatMap(played, (state) => State.get(state, Editing.joined.editor, Editing.Selection)),
    ).toEqual(Option.none());
    // How far each object has turned is only a client's, and the game playing turns it for itself.
    expect(Option.isSome(State.get(edited, Editing.box, Objects.Turn))).toBe(true);
    expect(Option.flatMap(played, (state) => State.get(state, Editing.box, Objects.Turn))).toEqual(
      Option.none(),
    );
    expect(Playing.fromOpening('not a document')).toEqual(Option.none());
  });

  it('takes no edits: a document playing is not one being edited', () => {
    expect(Playing.game.actions.map(({ tag }) => tag)).toEqual(['Clicked']);
  });
});
