import { describe, expect, it } from '@effect/vitest';
import { type Document, type Entity, type Rule, makeEntity } from '#src/document.ts';
import { type WorldEvent, changes, step } from '#src/play.ts';

const rule = (action: Rule['action'], target = 'self'): Rule => ({ id: 'rule', target, action });

const withRules = (entity: Entity, rules: ReadonlyArray<Rule>): Entity => ({ ...entity, rules });

const box = makeEntity('Box', 1);
const sphere = makeEntity('Sphere', 2);
const world = (entities: ReadonlyArray<Entity>): Document => ({ entities });
const click = (id: string): WorldEvent => ({ _tag: 'ClickedEntity', id });

describe('step', () => {
  it('sets the colour of the clicked entity', () => {
    const before = world([withRules(box, [rule({ _tag: 'SetColor', color: 0x00ff00 })])]);

    expect(step(before, click(box.id)).entities[0]?.color).toBe(0x00ff00);
  });

  it('moves the clicked entity by the offset, on every click', () => {
    const before = world([withRules(box, [rule({ _tag: 'MoveBy', offset: [1, 0, -2] })])]);

    const after = step(step(before, click(box.id)), click(box.id));

    expect(after.entities[0]?.position).toEqual([
      box.position[0] + 2,
      box.position[1],
      box.position[2] - 4,
    ]);
  });

  it('sets the spin speed of the clicked entity', () => {
    const before = world([withRules(box, [rule({ _tag: 'SetSpin', speed: 3 })])]);

    expect(step(before, click(box.id)).entities[0]?.spinSpeed).toBe(3);
  });

  it('acts on the target of a rule, not the clicked entity', () => {
    const before = world([
      withRules(box, [rule({ _tag: 'SetColor', color: 0x00ff00 }, sphere.id)]),
      sphere,
    ]);

    const [clicked, target] = step(before, click(box.id)).entities;

    expect(clicked?.color).toBe(box.color);
    expect(target?.color).toBe(0x00ff00);
  });

  it('applies every rule of the clicked entity, in order', () => {
    const before = world([
      withRules(box, [
        rule({ _tag: 'SetColor', color: 0x00ff00 }),
        rule({ _tag: 'MoveBy', offset: [0, 1, 0] }),
      ]),
    ]);

    const [after] = step(before, click(box.id)).entities;

    expect(after?.color).toBe(0x00ff00);
    expect(after?.position[1]).toBe(box.position[1] + 1);
  });

  it('leaves the world as it is when nothing applies', () => {
    const plain = world([box]);
    const orphaned = world([withRules(box, [rule({ _tag: 'SetSpin', speed: 3 }, 'missing')])]);

    expect(step(plain, click(box.id))).toBe(plain);
    expect(step(plain, click('missing'))).toBe(plain);
    expect(step(orphaned, click(box.id))).toEqual(orphaned);
  });
});

describe('changes', () => {
  it('lists each property that changed, by entity', () => {
    const before = world([box, sphere]);
    const after = world([{ ...box, color: 0x00ff00, position: [9, 9, 9] }, sphere]);

    expect(changes(before, after)).toEqual([
      { entityId: box.id, entityName: box.name, key: 'position' },
      { entityId: box.id, entityName: box.name, key: 'color' },
    ]);
  });

  it('lists nothing between equal worlds', () => {
    expect(changes(world([box]), world([{ ...box, position: [...box.position] }]))).toEqual([]);
  });
});
