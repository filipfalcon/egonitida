import { Effect, Option, type Scope } from 'effect';
import * as Three from 'three/webgpu';
import type * as Scene from '#src/Scene.ts';

/**
 * Owns the live Three.js graph for a program and keeps it matching the latest declared `Scene`.
 */
export interface SceneHost<Message> {
  readonly root: Three.Scene;
  readonly camera: Three.PerspectiveCamera;
  /** Draws `scene`; one where siblings share a key is a defect, and changes nothing that was drawn. */
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

type LiveMaterial = Three.MeshStandardNodeMaterial | Three.MeshBasicNodeMaterial;
type LiveMesh = Three.Mesh<Three.BufferGeometry, LiveMaterial>;

// The live counterpart of each kind of declared node: the node it was last brought in line with, and the Three.js object of exactly the kind that node produces.

interface MeshEntry<Message> {
  readonly kind: 'Mesh';
  node: Scene.Mesh<Message>;
  readonly object: LiveMesh;
  /** How far, in radians, the engine has spun the object on top of its declared rotation. */
  spun: number;
}

interface GroupEntry<Message> {
  readonly kind: 'Group';
  node: Scene.Group<Message>;
  readonly object: Three.Group;
  children: Entries<Message>;
  spun: number;
}

interface AmbientLightEntry {
  readonly kind: 'AmbientLight';
  node: Scene.AmbientLight;
  readonly object: Three.AmbientLight;
}

interface DirectionalLightEntry {
  readonly kind: 'DirectionalLight';
  node: Scene.DirectionalLight;
  readonly object: Three.DirectionalLight;
}

type Entry<Message> =
  | MeshEntry<Message>
  | GroupEntry<Message>
  | AmbientLightEntry
  | DirectionalLightEntry;

/** The entries the engine can move on its own. */
type AnimatedEntry<Message> = MeshEntry<Message> | GroupEntry<Message>;

type Entries<Message> = Map<string, Entry<Message>>;

/** What a host tracks across its entries. */
interface Live<Message> {
  /** The entries whose motion `step` advances. */
  readonly animated: Set<AnimatedEntry<Message>>;
  /** The entry each live object belongs to, so a raycast hit leads back to its declared node. */
  readonly owners: WeakMap<Three.Object3D, Entry<Message>>;
}

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
  mesh.material.color.setHex(next.color);
  mesh.material.wireframe = next.wireframe;
};

const spinAxis = new Three.Vector3();
const spinRotation = new Three.Quaternion();

/** Sets an object's rotation to its declared one, plus however far its spin has carried it. */
const orient = <Message>(entry: AnimatedEntry<Message>): void => {
  entry.object.rotation.set(...entry.node.rotation);
  if (Option.isSome(entry.node.motion)) {
    spinAxis.set(...entry.node.motion.value.axis).normalize();
    entry.object.quaternion.multiply(spinRotation.setFromAxisAngle(spinAxis, entry.spun));
  }
};

const animate = <Message>(live: Live<Message>, entry: AnimatedEntry<Message>): void => {
  if (Option.isSome(entry.node.motion)) {
    live.animated.add(entry);
  } else {
    live.animated.delete(entry);
    entry.spun = 0;
  }
  orient(entry);
};

// UPDATING
//
// Each kind of entry is brought in line with a node of its own kind.

const updateMesh = <Message>(
  live: Live<Message>,
  entry: MeshEntry<Message>,
  node: Scene.Mesh<Message>,
): void => {
  const previous = entry.node;
  entry.node = node;
  applyTransform(entry.object, node);
  animate(live, entry);
  if (!sameGeometry(previous.geometry, node.geometry)) {
    entry.object.geometry.dispose();
    entry.object.geometry = createGeometry(node.geometry);
  }
  updateMaterial(entry.object, previous.material, node.material);
};

const updateGroup = <Message>(
  live: Live<Message>,
  entry: GroupEntry<Message>,
  node: Scene.Group<Message>,
): void => {
  entry.node = node;
  applyTransform(entry.object, node);
  animate(live, entry);
  entry.children = reconcile(live, entry.object, entry.children, node.children);
};

const updateAmbientLight = (entry: AmbientLightEntry, node: Scene.AmbientLight): void => {
  entry.node = node;
  entry.object.color.setHex(node.color);
  entry.object.intensity = node.intensity;
};

const updateDirectionalLight = (
  entry: DirectionalLightEntry,
  node: Scene.DirectionalLight,
): void => {
  entry.node = node;
  applyTransform(entry.object, node);
  entry.object.color.setHex(node.color);
  entry.object.intensity = node.intensity;
};

/** Brings `entry` in line with `node`, if they are of the same kind; reports whether they were. */
const update = <Message>(
  live: Live<Message>,
  entry: Entry<Message>,
  node: Scene.Node<Message>,
): boolean => {
  switch (entry.kind) {
    case 'Mesh':
      if (node._tag === 'Mesh') {
        updateMesh(live, entry, node);
        return true;
      }
      return false;
    case 'Group':
      if (node._tag === 'Group') {
        updateGroup(live, entry, node);
        return true;
      }
      return false;
    case 'AmbientLight':
      if (node._tag === 'AmbientLight') {
        updateAmbientLight(entry, node);
        return true;
      }
      return false;
    case 'DirectionalLight':
      if (node._tag === 'DirectionalLight') {
        updateDirectionalLight(entry, node);
        return true;
      }
      return false;
  }
};

// CREATING

const createEntry = <Message>(live: Live<Message>, node: Scene.Node<Message>): Entry<Message> => {
  switch (node._tag) {
    case 'Mesh': {
      const entry: MeshEntry<Message> = {
        kind: 'Mesh',
        node,
        object: new Three.Mesh(createGeometry(node.geometry), createMaterial(node.material)),
        spun: 0,
      };
      updateMesh(live, entry, node);
      return entry;
    }
    case 'Group': {
      const entry: GroupEntry<Message> = {
        kind: 'Group',
        node,
        object: new Three.Group(),
        children: new Map(),
        spun: 0,
      };
      updateGroup(live, entry, node);
      return entry;
    }
    case 'AmbientLight': {
      const entry: AmbientLightEntry = {
        kind: 'AmbientLight',
        node,
        object: new Three.AmbientLight(),
      };
      updateAmbientLight(entry, node);
      return entry;
    }
    case 'DirectionalLight': {
      const entry: DirectionalLightEntry = {
        kind: 'DirectionalLight',
        node,
        object: new Three.DirectionalLight(),
      };
      updateDirectionalLight(entry, node);
      return entry;
    }
  }
};

const create = <Message>(live: Live<Message>, node: Scene.Node<Message>): Entry<Message> => {
  const entry = createEntry(live, node);
  entry.object.name = node.key;
  live.owners.set(entry.object, entry);
  return entry;
};

/** Detaches an entry and releases every GPU resource beneath it. */
const dispose = <Message>(live: Live<Message>, entry: Entry<Message>): void => {
  entry.object.removeFromParent();
  switch (entry.kind) {
    case 'Mesh':
      live.animated.delete(entry);
      entry.object.geometry.dispose();
      entry.object.material.dispose();
      return;
    case 'Group':
      live.animated.delete(entry);
      for (const child of entry.children.values()) {
        dispose(live, child);
      }
      return;
    case 'AmbientLight':
    case 'DirectionalLight':
      entry.object.dispose();
      return;
  }
};

/**
 * The path to the first key two siblings share, if any. Siblings are told apart by key alone, so a scene where two share one is refused before anything is drawn: one of the two objects would otherwise be made and never released.
 */
const sharedKey = <Message>(
  nodes: ReadonlyArray<Scene.Node<Message>>,
  path: ReadonlyArray<string> = [],
): Option.Option<ReadonlyArray<string>> => {
  const seen = new Set<string>();
  for (const node of nodes) {
    if (seen.has(node.key)) {
      return Option.some([...path, node.key]);
    }
    seen.add(node.key);
    if (node._tag === 'Group') {
      const within = sharedKey(node.children, [...path, node.key]);
      if (Option.isSome(within)) {
        return within;
      }
    }
  }
  return Option.none();
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
    if (existing !== undefined && update(live, existing, node)) {
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
      const live: Live<Message> = { animated: new Set(), owners: new WeakMap() };
      const state: { entries: Entries<Message>; onClickNothing: Option.Option<Message> } = {
        entries: new Map(),
        onClickNothing: Option.none(),
      };

      const render = (scene: Scene.Scene<Message>) =>
        Option.match(sharedKey(scene.nodes), {
          onSome: (path) =>
            Effect.die(
              new Error(
                `Siblings share the key "${path.join(' / ')}". Give each sibling its own key, from an id in the Model rather than its position.`,
              ),
            ),
          onNone: () =>
            Effect.sync(() => {
              applyCamera(camera, scene.camera);
              state.entries = reconcile(live, root, state.entries, scene.nodes);
              state.onClickNothing = scene.onClickNothing;
            }),
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
              Option.fromNullishOr(live.owners.get(hit.object)).pipe(
                Option.flatMap((entry) =>
                  entry.kind === 'Mesh' ? entry.node.onClick : Option.none(),
                ),
              ),
          });
        });

      // Runs every frame: one pass over the animated entries, with no Effect operation per object.
      const step = (seconds: number) =>
        Effect.sync(() => {
          for (const entry of live.animated) {
            if (Option.isSome(entry.node.motion)) {
              entry.spun += entry.node.motion.value.speed * seconds;
              orient(entry);
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
