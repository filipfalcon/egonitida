import { Effect, Option, type Scope } from 'effect';
import * as Three from 'three/webgpu';
import type * as Scene from '#src/Scene.ts';

/**
 * Owns the live Three.js graph for a program and keeps it matching the latest declared `Scene`.
 */
export interface SceneHost<Message> {
  readonly root: Three.Scene;
  readonly camera: Three.PerspectiveCamera;
  readonly render: (scene: Scene.Scene<Message>) => Effect.Effect<void>;
  /** The Message of the nearest object under the pointer, if that object handles clicks. */
  readonly pick: (pointer: Pointer) => Effect.Effect<Option.Option<Message>>;
  /** Advances every declared motion by `seconds`, without involving the program. */
  readonly step: (seconds: number) => Effect.Effect<void>;
}

/** A pointer position in normalized device coordinates: -1 to 1 on both axes, with y pointing up. */
export interface Pointer {
  readonly x: number;
  readonly y: number;
}

/** The live counterpart of a declared node: the object it produced, and for a group, its children by key. */
interface Entry<Message> {
  node: Scene.Node<Message>;
  readonly object: Three.Object3D;
  children: Entries<Message>;
  /** How far, in radians, the engine has spun the object on top of its declared rotation. */
  spun: number;
}

type Entries<Message> = Map<string, Entry<Message>>;

/** What a host tracks across its entries: the ones whose motion `step` advances. */
interface Live<Message> {
  readonly animated: Set<Entry<Message>>;
}

type LiveMesh = Three.Mesh<Three.BufferGeometry, Three.Material>;

/** The entry each live object belongs to, so that a raycast hit leads back to its declared node. */
const owners = new WeakMap<Three.Object3D, Entry<unknown>>();

const applyTransform = (object: Three.Object3D, transform: Scene.Transform): void => {
  object.position.set(...transform.position);
  object.rotation.set(...transform.rotation);
  object.scale.set(...transform.scale);
};

const createGeometry = (geometry: Scene.Geometry): Three.BufferGeometry => {
  switch (geometry._tag) {
    case 'Box':
      return new Three.BoxGeometry(geometry.width, geometry.height, geometry.depth);
    case 'Sphere':
      return new Three.SphereGeometry(geometry.radius);
  }
};

const sameGeometry = (previous: Scene.Geometry, next: Scene.Geometry): boolean => {
  switch (next._tag) {
    case 'Box':
      return (
        previous._tag === 'Box' &&
        previous.width === next.width &&
        previous.height === next.height &&
        previous.depth === next.depth
      );
    case 'Sphere':
      return previous._tag === 'Sphere' && previous.radius === next.radius;
  }
};

type LiveMaterial = Three.MeshStandardNodeMaterial | Three.MeshBasicNodeMaterial;

const createMaterial = (material: Scene.Material): LiveMaterial => {
  switch (material._tag) {
    case 'Standard':
      return new Three.MeshStandardNodeMaterial();
    case 'Basic':
      return new Three.MeshBasicNodeMaterial();
  }
};

/** Brings a mesh's material in line with the declared one, replacing it only when the kind changes. */
const updateMaterial = (mesh: LiveMesh, previous: Scene.Material, next: Scene.Material): void => {
  if (previous._tag !== next._tag) {
    mesh.material.dispose();
    mesh.material = createMaterial(next);
  }
  const material = mesh.material as LiveMaterial;
  material.color.setHex(next.color);
  material.wireframe = next.wireframe;
};

const spinAxis = new Three.Vector3();
const spinRotation = new Three.Quaternion();

/** Sets an object's rotation to its declared one, plus however far its spin has carried it. */
const orient = <Message>(entry: Entry<Message>, node: Scene.Transform & Scene.Animated): void => {
  entry.object.rotation.set(...node.rotation);
  if (Option.isSome(node.motion)) {
    spinAxis.set(...node.motion.value.axis).normalize();
    entry.object.quaternion.multiply(spinRotation.setFromAxisAngle(spinAxis, entry.spun));
  }
};

const animate = <Message>(
  live: Live<Message>,
  entry: Entry<Message>,
  node: Scene.Transform & Scene.Animated,
): void => {
  if (Option.isSome(node.motion)) {
    live.animated.add(entry);
  } else {
    live.animated.delete(entry);
    entry.spun = 0;
  }
  orient(entry, node);
};

const create = <Message>(live: Live<Message>, node: Scene.Node<Message>): Entry<Message> => {
  const entry: Entry<Message> = { node, object: createObject(node), children: new Map(), spun: 0 };
  entry.object.name = node.key;
  owners.set(entry.object, entry);
  update(live, entry, node);
  return entry;
};

const createObject = <Message>(node: Scene.Node<Message>): Three.Object3D => {
  switch (node._tag) {
    case 'Mesh':
      return new Three.Mesh(createGeometry(node.geometry), createMaterial(node.material));
    case 'Group':
      return new Three.Group();
    case 'AmbientLight':
      return new Three.AmbientLight();
    case 'DirectionalLight':
      return new Three.DirectionalLight();
  }
};

/** Brings a live entry in line with a node of the same kind. */
const update = <Message>(
  live: Live<Message>,
  entry: Entry<Message>,
  node: Scene.Node<Message>,
): void => {
  const previous = entry.node;
  entry.node = node;
  switch (node._tag) {
    case 'Mesh': {
      const mesh = entry.object as LiveMesh;
      applyTransform(mesh, node);
      animate(live, entry, node);
      if (previous._tag === 'Mesh' && !sameGeometry(previous.geometry, node.geometry)) {
        mesh.geometry.dispose();
        mesh.geometry = createGeometry(node.geometry);
      }
      updateMaterial(
        mesh,
        previous._tag === 'Mesh' ? previous.material : node.material,
        node.material,
      );
      return;
    }
    case 'Group':
      applyTransform(entry.object, node);
      animate(live, entry, node);
      entry.children = reconcile(live, entry.object, entry.children, node.children);
      return;
    case 'AmbientLight': {
      const light = entry.object as Three.AmbientLight;
      light.color.setHex(node.color);
      light.intensity = node.intensity;
      return;
    }
    case 'DirectionalLight': {
      const light = entry.object as Three.DirectionalLight;
      applyTransform(light, node);
      light.color.setHex(node.color);
      light.intensity = node.intensity;
      return;
    }
  }
};

/** Detaches an entry and releases every GPU resource beneath it. */
const dispose = <Message>(live: Live<Message>, entry: Entry<Message>): void => {
  entry.object.removeFromParent();
  live.animated.delete(entry);
  switch (entry.node._tag) {
    case 'Mesh': {
      const mesh = entry.object as LiveMesh;
      mesh.geometry.dispose();
      mesh.material.dispose();
      return;
    }
    case 'Group':
      for (const child of entry.children.values()) {
        dispose(live, child);
      }
      return;
    case 'AmbientLight':
    case 'DirectionalLight':
      (entry.object as Three.Light).dispose();
      return;
  }
};

/**
 * Makes the children of `parent` match `nodes`: entries whose key survives with the same kind are updated in place, the rest are created or disposed, and the children end up in declared order.
 */
const reconcile = <Message>(
  live: Live<Message>,
  parent: Three.Object3D,
  previous: Entries<Message>,
  nodes: ReadonlyArray<Scene.Node<Message>>,
): Entries<Message> => {
  const stale = new Map(previous);
  const next: Entries<Message> = new Map();
  for (const node of nodes) {
    const existing = stale.get(node.key);
    stale.delete(node.key);
    if (existing !== undefined && existing.node._tag === node._tag) {
      update(live, existing, node);
      next.set(node.key, existing);
    } else {
      if (existing !== undefined) {
        dispose(live, existing);
      }
      next.set(node.key, create(live, node));
    }
  }
  for (const entry of stale.values()) {
    dispose(live, entry);
  }
  const ordered = Array.from(next.values(), (entry) => entry.object);
  for (const object of ordered) {
    if (object.parent !== parent) {
      parent.add(object);
    }
  }
  // Every child of a reconciled parent is one of its entries, so the declared order is the whole list.
  parent.children.splice(0, parent.children.length, ...ordered);
  return next;
};

const applyCamera = (camera: Three.PerspectiveCamera, declared: Scene.PerspectiveCamera): void => {
  camera.position.set(...declared.position);
  camera.rotation.set(...declared.rotation);
  camera.fov = declared.fov;
  camera.near = declared.near;
  camera.far = declared.far;
  camera.updateProjectionMatrix();
};

export const make = <Message>(): Effect.Effect<SceneHost<Message>, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const root = new Three.Scene();
      const camera = new Three.PerspectiveCamera();
      const live: Live<Message> = { animated: new Set() };
      const state = {
        entries: new Map() as Entries<Message>,
        onClickNothing: Option.none() as Option.Option<Message>,
      };

      const render = (scene: Scene.Scene<Message>) =>
        Effect.sync(() => {
          applyCamera(camera, scene.camera);
          state.entries = reconcile(live, root, state.entries, scene.nodes);
          state.onClickNothing = scene.onClickNothing;
        });

      const raycaster = new Three.Raycaster();
      const pick = (pointer: Pointer) =>
        Effect.sync(() => {
          root.updateMatrixWorld();
          camera.updateMatrixWorld();
          raycaster.setFromCamera(new Three.Vector2(pointer.x, pointer.y), camera);
          const [nearest] = raycaster.intersectObjects(root.children, true);
          return Option.match(Option.fromNullishOr(nearest), {
            onNone: () => state.onClickNothing,
            onSome: (hit) =>
              Option.fromNullishOr(owners.get(hit.object)).pipe(
                Option.flatMap((entry) =>
                  entry.node._tag === 'Mesh'
                    ? (entry.node.onClick as Option.Option<Message>)
                    : Option.none(),
                ),
              ),
          });
        });

      // Runs every frame: one pass over the animated entries, with no Effect operation per object.
      const step = (seconds: number) =>
        Effect.sync(() => {
          for (const entry of live.animated) {
            const node = entry.node as Scene.Mesh<Message> | Scene.Group<Message>;
            if (Option.isSome(node.motion)) {
              entry.spun += node.motion.value.speed * seconds;
              orient(entry, node);
            }
          }
        });

      const release = () => {
        state.entries = reconcile(live, root, state.entries, []);
      };

      return { host: { root, camera, render, pick, step }, release };
    }),
    ({ release }) => Effect.sync(release),
  ).pipe(Effect.map(({ host }) => host));
