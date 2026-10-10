import { describe, expect, it } from '@effect/vitest';
import { Option, Schema } from 'effect';
import * as Inspector from '#src/Inspector.ts';

const Vector3 = Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite]);

const Thing = Schema.Struct({
  id: Schema.String,
  name: Schema.String.annotate({ title: 'Name', inspector: Inspector.text() }),
  shape: Schema.Literals(['Box', 'Sphere']).annotate({
    title: 'Shape',
    inspector: Inspector.choice(),
  }),
  position: Vector3.annotate({ title: 'Position', inspector: Inspector.vector3({ step: 0.1 }) }),
  color: Schema.Int.annotate({ inspector: Inspector.color() }),
  speed: Schema.Finite.annotate({
    title: 'Speed',
    inspector: Inspector.number({ min: 0, max: 10, step: 0.5 }),
  }),
});
type Thing = typeof Thing.Type;

const thing: Thing = {
  id: 'thing-1',
  name: 'Thing',
  shape: 'Box',
  position: [0, 0, 0],
  color: 0xffffff,
  speed: 1,
};

describe('Inspector', () => {
  describe('properties', () => {
    it('lists the annotated fields in their declared order', () => {
      expect(Inspector.properties(Thing).map((property) => property.key)).toEqual([
        'name',
        'shape',
        'position',
        'color',
        'speed',
      ]);
    });

    it('leaves out the fields without an inspector annotation', () => {
      expect(Inspector.properties(Thing).map((property) => property.key)).not.toContain('id');
    });

    it('titles a property by its annotation, falling back to its key', () => {
      const titles = Inspector.properties(Thing).map((property) => property.title);

      expect(titles).toEqual(['Name', 'Shape', 'Position', 'color', 'Speed']);
    });

    it('describes each widget with its settings', () => {
      const widgets = Inspector.properties(Thing).map((property) => property.widget);

      expect(widgets).toEqual([
        { _tag: 'Text' },
        { _tag: 'Choice', options: ['Box', 'Sphere'] },
        { _tag: 'Vector3', step: 0.1 },
        { _tag: 'Color' },
        { _tag: 'Number', min: Option.some(0), max: Option.some(10), step: 0.5 },
      ]);
    });

    it('gives a number widget no bounds and a step of one by default', () => {
      const Plain = Schema.Struct({
        count: Schema.Int.annotate({ inspector: Inspector.number() }),
      });

      expect(Inspector.properties(Plain)[0]?.widget).toEqual({
        _tag: 'Number',
        min: Option.none(),
        max: Option.none(),
        step: 1,
      });
    });
  });

  describe('edit', () => {
    it('replaces a field with a candidate its schema accepts', () => {
      expect(Inspector.edit(Thing, thing, 'name', 'Renamed')).toEqual(
        Option.some({ ...thing, name: 'Renamed' }),
      );
      expect(Inspector.edit(Thing, thing, 'position', [1, 2, 3])).toEqual(
        Option.some({ ...thing, position: [1, 2, 3] }),
      );
    });

    it('rejects a candidate its schema does not accept', () => {
      expect(Inspector.edit(Thing, thing, 'speed', Number.NaN)).toEqual(Option.none());
      expect(Inspector.edit(Thing, thing, 'shape', 'Cone')).toEqual(Option.none());
      expect(Inspector.edit(Thing, thing, 'position', [1, 2])).toEqual(Option.none());
    });

    it('rejects a key the schema does not have', () => {
      expect(Inspector.edit(Thing, thing, 'missing', 1)).toEqual(Option.none());
    });
  });
});
