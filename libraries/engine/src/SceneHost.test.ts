import { assert, describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import * as Three from 'three/webgpu';
import * as Scene from '#src/Scene.ts';
import * as SceneHost from '#src/SceneHost.ts';

const camera = Scene.perspectiveCamera({ position: [0, 0, 10] });

const cube = (options: Partial<Parameters<typeof Scene.mesh<never>>[0]> = {}): Scene.Node<never> =>
  Scene.mesh({
    key: 'cube',
    geometry: Scene.box({ width: 1, height: 1, depth: 1 }),
    material: Scene.standard({ color: 0xff0000 }),
    ...options,
  });

const childNamed = (parent: Three.Object3D, name: string): Three.Object3D => {
  const child = parent.getObjectByName(name);
  assert(child !== undefined, `there is a child named ${name}`);
  return child;
};

/** `value`, checked to be an instance of `kind`; the test fails where it is not. */
const ofKind = <T>(value: unknown, kind: abstract new (...args: never[]) => T): T => {
  assert(value instanceof kind, `the value is a ${kind.name}`);
  return value;
};

/** The child of `parent` named `name`, checked to be of `kind`. */
const named = <T>(
  parent: Three.Object3D,
  name: string,
  kind: abstract new (...args: never[]) => T,
): T => ofKind(childNamed(parent, name), kind);

describe('SceneHost', () => {
  describe('rendering', () => {
    it.effect('creates a mesh for a declared mesh node', () =>
      Effect.gen(function* () {
        const host = yield* SceneHost.make<never>();
        yield* host.render(Scene.scene({ camera, nodes: [cube({ position: [1, 2, 3] })] }));

        const mesh = named(host.root, 'cube', Three.Mesh);
        expect(mesh.isMesh).toBe(true);
        expect(mesh.position.toArray()).toEqual([1, 2, 3]);
        expect(mesh.geometry).toBeInstanceOf(Three.BoxGeometry);
        expect(ofKind(mesh.geometry, Three.BoxGeometry).parameters).toMatchObject({
          width: 1,
          height: 1,
          depth: 1,
        });
        const material = ofKind(mesh.material, Three.MeshStandardNodeMaterial);
        expect(material.isNodeMaterial).toBe(true);
        expect(material.color.getHex()).toBe(0xff0000);
      }),
    );

    it.effect('creates a sphere geometry for a sphere node', () =>
      Effect.gen(function* () {
        const host = yield* SceneHost.make<never>();
        yield* host.render(
          Scene.scene({
            camera,
            nodes: [cube({ geometry: Scene.sphere({ radius: 2 }) })],
          }),
        );

        const mesh = named(host.root, 'cube', Three.Mesh);
        expect(mesh.geometry).toBeInstanceOf(Three.SphereGeometry);
        expect(ofKind(mesh.geometry, Three.SphereGeometry).parameters.radius).toBe(2);
      }),
    );

    it.effect('nests the children of a group under it, in order', () =>
      Effect.gen(function* () {
        const host = yield* SceneHost.make<never>();
        yield* host.render(
          Scene.scene({
            camera,
            nodes: [
              Scene.group({
                key: 'group',
                position: [5, 0, 0],
                children: [cube({ key: 'a' }), cube({ key: 'b' })],
              }),
            ],
          }),
        );

        const group = childNamed(host.root, 'group');
        expect(group.position.x).toBe(5);
        expect(group.children.map((child) => child.name)).toEqual(['a', 'b']);
      }),
    );

    it.effect('creates lights with their colour and intensity', () =>
      Effect.gen(function* () {
        const host = yield* SceneHost.make<never>();
        yield* host.render(
          Scene.scene({
            camera,
            nodes: [
              Scene.ambientLight({ key: 'ambient', intensity: 0.5 }),
              Scene.directionalLight({
                key: 'sun',
                color: 0xffeedd,
                intensity: 2,
                position: [1, 1, 1],
              }),
            ],
          }),
        );

        const ambient = named(host.root, 'ambient', Three.AmbientLight);
        expect(ambient.isAmbientLight).toBe(true);
        expect(ambient.intensity).toBe(0.5);
        const sun = named(host.root, 'sun', Three.DirectionalLight);
        expect(sun.isDirectionalLight).toBe(true);
        expect(sun.color.getHex()).toBe(0xffeedd);
        expect(sun.intensity).toBe(2);
        expect(sun.position.toArray()).toEqual([1, 1, 1]);
      }),
    );

    it.effect('applies the declared camera', () =>
      Effect.gen(function* () {
        const host = yield* SceneHost.make<never>();
        yield* host.render(
          Scene.scene({
            camera: Scene.perspectiveCamera({
              position: [0, 5, 10],
              fov: 60,
              near: 0.5,
              far: 500,
            }),
            nodes: [],
          }),
        );

        expect(host.camera.position.toArray()).toEqual([0, 5, 10]);
        expect(host.camera.fov).toBe(60);
        expect(host.camera.near).toBe(0.5);
        expect(host.camera.far).toBe(500);
      }),
    );
  });

  describe('reconciling', () => {
    it.effect('keeps the object of a node whose key survives, and updates it', () =>
      Effect.gen(function* () {
        const host = yield* SceneHost.make<never>();
        yield* host.render(Scene.scene({ camera, nodes: [cube({ position: [0, 0, 0] })] }));
        const before = named(host.root, 'cube', Three.Mesh);
        const geometry = before.geometry;

        yield* host.render(
          Scene.scene({
            camera,
            nodes: [cube({ position: [4, 0, 0], material: Scene.standard({ color: 0x00ff00 }) })],
          }),
        );

        const after = named(host.root, 'cube', Three.Mesh);
        expect(after).toBe(before);
        expect(after.geometry).toBe(geometry);
        expect(after.position.x).toBe(4);
        expect(ofKind(after.material, Three.MeshStandardNodeMaterial).color.getHex()).toBe(
          0x00ff00,
        );
      }),
    );

    it.effect('replaces and disposes the geometry when its parameters change', () =>
      Effect.gen(function* () {
        const host = yield* SceneHost.make<never>();
        yield* host.render(Scene.scene({ camera, nodes: [cube()] }));
        const mesh = named(host.root, 'cube', Three.Mesh);
        const disposed = watchDisposal(mesh.geometry);

        yield* host.render(
          Scene.scene({
            camera,
            nodes: [cube({ geometry: Scene.box({ width: 2, height: 1, depth: 1 }) })],
          }),
        );

        expect(disposed()).toBe(true);
        expect(childNamed(host.root, 'cube')).toBe(mesh);
        expect(ofKind(mesh.geometry, Three.BoxGeometry).parameters.width).toBe(2);
      }),
    );

    it.effect('removes the object of a node that disappears, disposing its resources', () =>
      Effect.gen(function* () {
        const host = yield* SceneHost.make<never>();
        yield* host.render(Scene.scene({ camera, nodes: [cube()] }));
        const mesh = named(host.root, 'cube', Three.Mesh);
        const geometryDisposed = watchDisposal(mesh.geometry);
        const materialDisposed = watchDisposal(ofKind(mesh.material, Three.Material));

        yield* host.render(Scene.scene({ camera, nodes: [] }));

        expect(host.root.getObjectByName('cube')).toBeUndefined();
        expect(geometryDisposed()).toBe(true);
        expect(materialDisposed()).toBe(true);
      }),
    );

    it.effect('disposes the resources under a removed group', () =>
      Effect.gen(function* () {
        const host = yield* SceneHost.make<never>();
        yield* host.render(
          Scene.scene({
            camera,
            nodes: [Scene.group({ key: 'group', children: [cube()] })],
          }),
        );
        const mesh = named(host.root, 'cube', Three.Mesh);
        const disposed = watchDisposal(mesh.geometry);

        yield* host.render(Scene.scene({ camera, nodes: [] }));

        expect(disposed()).toBe(true);
      }),
    );

    it.effect('replaces the object when a key changes kind', () =>
      Effect.gen(function* () {
        const host = yield* SceneHost.make<never>();
        yield* host.render(Scene.scene({ camera, nodes: [cube({ key: 'thing' })] }));
        const mesh = named(host.root, 'thing', Three.Mesh);
        const disposed = watchDisposal(mesh.geometry);

        yield* host.render(
          Scene.scene({ camera, nodes: [Scene.group({ key: 'thing', children: [] })] }),
        );

        const thing = childNamed(host.root, 'thing');
        expect(thing).toBeInstanceOf(Three.Group);
        expect(disposed()).toBe(true);
      }),
    );

    it.effect('reorders surviving objects to follow the declared order', () =>
      Effect.gen(function* () {
        const host = yield* SceneHost.make<never>();
        yield* host.render(
          Scene.scene({
            camera,
            nodes: [cube({ key: 'a' }), cube({ key: 'b' }), cube({ key: 'c' })],
          }),
        );
        const a = childNamed(host.root, 'a');

        yield* host.render(
          Scene.scene({
            camera,
            nodes: [cube({ key: 'c' }), cube({ key: 'a' }), cube({ key: 'd' })],
          }),
        );

        expect(host.root.children.map((child) => child.name)).toEqual(['c', 'a', 'd']);
        expect(childNamed(host.root, 'a')).toBe(a);
        expect(a.parent).toBe(host.root);
      }),
    );

    it.effect('reconciles the children of a surviving group by key', () =>
      Effect.gen(function* () {
        const host = yield* SceneHost.make<never>();
        yield* host.render(
          Scene.scene({
            camera,
            nodes: [Scene.group({ key: 'group', children: [cube({ key: 'a' })] })],
          }),
        );
        const group = childNamed(host.root, 'group');
        const a = childNamed(group, 'a');

        yield* host.render(
          Scene.scene({
            camera,
            nodes: [
              Scene.group({
                key: 'group',
                children: [cube({ key: 'a' }), cube({ key: 'b' })],
              }),
            ],
          }),
        );

        expect(childNamed(host.root, 'group')).toBe(group);
        expect(childNamed(group, 'a')).toBe(a);
        expect(group.children.map((child) => child.name)).toEqual(['a', 'b']);
      }),
    );
  });

  describe('picking', () => {
    const target = (key: string, z: number, onClick?: string): Scene.Node<string> =>
      Scene.mesh({
        key,
        geometry: Scene.box({ width: 1, height: 1, depth: 1 }),
        material: Scene.standard({ color: 0xffffff }),
        position: [0, 0, z],
        ...(onClick === undefined ? {} : { onClick }),
      });

    const center = { x: 0, y: 0 };

    it.effect('produces the message of the mesh under the pointer', () =>
      Effect.gen(function* () {
        const host = yield* SceneHost.make<string>();
        yield* host.render(Scene.scene({ camera, nodes: [target('cube', 0, 'clicked')] }));

        const picked = yield* host.pick(center);
        expect(picked).toEqual(Option.some('clicked'));
      }),
    );

    it.effect('produces nothing when the pointer misses', () =>
      Effect.gen(function* () {
        const host = yield* SceneHost.make<string>();
        yield* host.render(Scene.scene({ camera, nodes: [target('cube', 0, 'clicked')] }));

        const picked = yield* host.pick({ x: 0.9, y: 0.9 });
        expect(picked).toEqual(Option.none());
      }),
    );

    it.effect('produces the message of the nearest mesh', () =>
      Effect.gen(function* () {
        const host = yield* SceneHost.make<string>();
        yield* host.render(
          Scene.scene({ camera, nodes: [target('far', -3, 'far'), target('near', 3, 'near')] }),
        );

        const picked = yield* host.pick(center);
        expect(picked).toEqual(Option.some('near'));
      }),
    );

    it.effect('lets a nearer mesh without a handler block the pick', () =>
      Effect.gen(function* () {
        const host = yield* SceneHost.make<string>();
        yield* host.render(
          Scene.scene({ camera, nodes: [target('far', -3, 'far'), target('wall', 3)] }),
        );

        const picked = yield* host.pick(center);
        expect(picked).toEqual(Option.none());
      }),
    );

    it.effect('produces the message from the latest render', () =>
      Effect.gen(function* () {
        const host = yield* SceneHost.make<string>();
        yield* host.render(Scene.scene({ camera, nodes: [target('cube', 0, 'first')] }));
        yield* host.render(Scene.scene({ camera, nodes: [target('cube', 0, 'second')] }));

        const picked = yield* host.pick(center);
        expect(picked).toEqual(Option.some('second'));
      }),
    );

    it.effect('picks a mesh where the latest render placed it', () =>
      Effect.gen(function* () {
        const host = yield* SceneHost.make<string>();
        yield* host.render(Scene.scene({ camera, nodes: [target('cube', 0, 'clicked')] }));
        yield* host.render(
          Scene.scene({
            camera,
            nodes: [
              Scene.mesh({
                key: 'cube',
                geometry: Scene.box({ width: 1, height: 1, depth: 1 }),
                material: Scene.standard({ color: 0xffffff }),
                position: [100, 0, 0],
                onClick: 'clicked',
              }),
            ],
          }),
        );

        const picked = yield* host.pick(center);
        expect(picked).toEqual(Option.none());
      }),
    );

    it.effect('produces the scene’s message for a click that hits nothing', () =>
      Effect.gen(function* () {
        const host = yield* SceneHost.make<string>();
        yield* host.render(
          Scene.scene({
            camera,
            nodes: [target('cube', 0, 'clicked')],
            onClickNothing: 'nothing',
          }),
        );

        const picked = yield* host.pick({ x: 0.9, y: 0.9 });
        expect(picked).toEqual(Option.some('nothing'));
      }),
    );

    it.effect('does not treat a hit without a handler as a click on nothing', () =>
      Effect.gen(function* () {
        const host = yield* SceneHost.make<string>();
        yield* host.render(
          Scene.scene({ camera, nodes: [target('wall', 0)], onClickNothing: 'nothing' }),
        );

        const picked = yield* host.pick(center);
        expect(picked).toEqual(Option.none());
      }),
    );
  });

  describe('materials', () => {
    const materialOf = (host: SceneHost.SceneHost<never>) =>
      ofKind(named(host.root, 'cube', Three.Mesh).material, Three.Material);

    it.effect('creates an unlit material for a basic material', () =>
      Effect.gen(function* () {
        const host = yield* SceneHost.make<never>();
        yield* host.render(
          Scene.scene({ camera, nodes: [cube({ material: Scene.basic({ color: 0x00ff00 }) })] }),
        );

        const material = ofKind(materialOf(host), Three.MeshBasicNodeMaterial);
        expect(material).toBeInstanceOf(Three.MeshBasicNodeMaterial);
        expect(material.color.getHex()).toBe(0x00ff00);
      }),
    );

    it.effect('draws a wireframe material as a wireframe, and updates it in place', () =>
      Effect.gen(function* () {
        const host = yield* SceneHost.make<never>();
        yield* host.render(
          Scene.scene({
            camera,
            nodes: [cube({ material: Scene.standard({ color: 0xffffff, wireframe: true }) })],
          }),
        );
        const material = ofKind(materialOf(host), Three.MeshStandardNodeMaterial);
        expect(material.wireframe).toBe(true);

        yield* host.render(
          Scene.scene({ camera, nodes: [cube({ material: Scene.standard({ color: 0xffffff }) })] }),
        );

        expect(materialOf(host)).toBe(material);
        expect(material.wireframe).toBe(false);
      }),
    );

    it.effect('replaces and disposes the material when its kind changes', () =>
      Effect.gen(function* () {
        const host = yield* SceneHost.make<never>();
        yield* host.render(Scene.scene({ camera, nodes: [cube()] }));
        const before = materialOf(host);
        const disposed = watchDisposal(before);

        yield* host.render(
          Scene.scene({ camera, nodes: [cube({ material: Scene.basic({ color: 0x0000ff }) })] }),
        );

        expect(disposed()).toBe(true);
        expect(materialOf(host)).toBeInstanceOf(Three.MeshBasicNodeMaterial);
      }),
    );
  });

  describe('motion', () => {
    const quarterTurn = Math.PI / 2;
    const aroundY = (angle: number) =>
      new Three.Quaternion().setFromAxisAngle(new Three.Vector3(0, 1, 0), angle);
    const expectOrientation = (object: Three.Object3D, expected: Three.Quaternion) =>
      expect(object.quaternion.angleTo(expected)).toBeCloseTo(0, 6);
    const spinning = (options: Partial<Parameters<typeof Scene.mesh<never>>[0]> = {}) =>
      cube({ motion: Scene.spin({ axis: [0, 1, 0], speed: quarterTurn }), ...options });

    it.effect('advances a spinning mesh by its speed over the elapsed time', () =>
      Effect.gen(function* () {
        const host = yield* SceneHost.make<never>();
        yield* host.render(Scene.scene({ camera, nodes: [spinning()] }));

        yield* host.step(1);

        expectOrientation(childNamed(host.root, 'cube'), aroundY(quarterTurn));
      }),
    );

    it.effect('spins on top of the declared rotation', () =>
      Effect.gen(function* () {
        const host = yield* SceneHost.make<never>();
        yield* host.render(
          Scene.scene({ camera, nodes: [spinning({ rotation: [0, quarterTurn, 0] })] }),
        );

        yield* host.step(1);

        expectOrientation(childNamed(host.root, 'cube'), aroundY(Math.PI));
      }),
    );

    it.effect('keeps the progress of a spin across renders', () =>
      Effect.gen(function* () {
        const host = yield* SceneHost.make<never>();
        yield* host.render(Scene.scene({ camera, nodes: [spinning()] }));
        yield* host.step(1);

        yield* host.render(Scene.scene({ camera, nodes: [spinning({ position: [1, 0, 0] })] }));
        expectOrientation(childNamed(host.root, 'cube'), aroundY(quarterTurn));

        yield* host.step(1);
        expectOrientation(childNamed(host.root, 'cube'), aroundY(Math.PI));
      }),
    );

    it.effect('returns to the declared rotation when the spin is removed', () =>
      Effect.gen(function* () {
        const host = yield* SceneHost.make<never>();
        yield* host.render(Scene.scene({ camera, nodes: [spinning()] }));
        yield* host.step(1);

        yield* host.render(Scene.scene({ camera, nodes: [cube()] }));
        yield* host.step(1);

        expectOrientation(childNamed(host.root, 'cube'), aroundY(0));
      }),
    );

    it.effect('spins a group together with its children', () =>
      Effect.gen(function* () {
        const host = yield* SceneHost.make<never>();
        yield* host.render(
          Scene.scene({
            camera,
            nodes: [
              Scene.group({
                key: 'group',
                motion: Scene.spin({ axis: [0, 1, 0], speed: quarterTurn }),
                children: [cube()],
              }),
            ],
          }),
        );

        yield* host.step(2);

        expectOrientation(childNamed(host.root, 'group'), aroundY(Math.PI));
      }),
    );

    it.effect('stops advancing a spinning mesh once it is removed', () =>
      Effect.gen(function* () {
        const host = yield* SceneHost.make<never>();
        yield* host.render(Scene.scene({ camera, nodes: [spinning()] }));
        const mesh = childNamed(host.root, 'cube');

        yield* host.render(Scene.scene({ camera, nodes: [] }));
        yield* host.step(1);

        expectOrientation(mesh, aroundY(0));
      }),
    );
  });

  describe('lifetime', () => {
    it.effect('disposes every resource when its scope closes', () =>
      Effect.gen(function* () {
        const disposed = yield* Effect.scoped(
          Effect.gen(function* () {
            const host = yield* SceneHost.make<never>();
            yield* host.render(
              Scene.scene({
                camera,
                nodes: [Scene.group({ key: 'group', children: [cube()] })],
              }),
            );
            const mesh = named(host.root, 'cube', Three.Mesh);
            return [
              watchDisposal(mesh.geometry),
              watchDisposal(ofKind(mesh.material, Three.Material)),
            ];
          }),
        );

        expect(disposed.map((check) => check())).toEqual([true, true]);
      }),
    );
  });
});

function watchDisposal(resource: Three.BufferGeometry | Three.Material): () => boolean {
  let disposed = false;
  resource.addEventListener('dispose', () => {
    disposed = true;
  });
  return () => disposed;
}
