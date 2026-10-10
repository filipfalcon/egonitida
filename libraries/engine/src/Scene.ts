import { Option } from 'effect';

/**
 * The declarative description of a Three.js world: what `viewScene` returns. It holds data only; `SceneHost` turns it into live objects.
 */

export type Vector3 = readonly [x: number, y: number, z: number];

export interface Transform {
  readonly position: Vector3;
  /** Euler angles in radians, applied in XYZ order. */
  readonly rotation: Vector3;
  readonly scale: Vector3;
}

export interface TransformOptions {
  readonly position?: Vector3;
  readonly rotation?: Vector3;
  readonly scale?: Vector3;
}

const transform = (options: TransformOptions): Transform => ({
  position: options.position ?? [0, 0, 0],
  rotation: options.rotation ?? [0, 0, 0],
  scale: options.scale ?? [1, 1, 1],
});

// Geometry

export interface Box {
  readonly _tag: 'Box';
  readonly width: number;
  readonly height: number;
  readonly depth: number;
}

export interface Sphere {
  readonly _tag: 'Sphere';
  readonly radius: number;
}

export type Geometry = Box | Sphere;

export const box = (options: Omit<Box, '_tag'>): Box => ({
  _tag: 'Box',
  ...options,
});

export const sphere = (options: Omit<Sphere, '_tag'>): Sphere => ({
  _tag: 'Sphere',
  ...options,
});

// Material

/** A physically based material, lit by the scene's lights. */
export interface Standard {
  readonly _tag: 'Standard';
  readonly color: number;
  readonly wireframe: boolean;
}

/** An unlit material: its colour shows the same whatever the lights. */
export interface Basic {
  readonly _tag: 'Basic';
  readonly color: number;
  readonly wireframe: boolean;
}

export type Material = Standard | Basic;

export interface MaterialOptions {
  readonly color: number;
  readonly wireframe?: boolean;
}

export const standard = (options: MaterialOptions): Standard => ({
  _tag: 'Standard',
  color: options.color,
  wireframe: options.wireframe ?? false,
});

export const basic = (options: MaterialOptions): Basic => ({
  _tag: 'Basic',
  color: options.color,
  wireframe: options.wireframe ?? false,
});

// Motion

/** A continuous rotation about `axis`, advanced by the engine every frame without involving the program. */
export interface Spin {
  readonly _tag: 'Spin';
  readonly axis: Vector3;
  /** Radians per second. */
  readonly speed: number;
}

export type Motion = Spin;

export const spin = (options: Omit<Spin, '_tag'>): Spin => ({
  _tag: 'Spin',
  ...options,
});

/** A node whose transform the engine may animate on top of what is declared. */
export interface Animated {
  readonly motion: Option.Option<Motion>;
}

export interface AnimatedOptions {
  readonly motion?: Motion;
}

const animated = (options: AnimatedOptions): Animated => ({
  motion: Option.fromNullishOr(options.motion),
});

// Nodes

export interface Mesh<Message> extends Transform, Animated {
  readonly _tag: 'Mesh';
  readonly key: string;
  readonly geometry: Geometry;
  readonly material: Material;
  /** The Message a pick on this mesh produces. */
  readonly onClick: Option.Option<Message>;
}

export interface Group<Message> extends Transform, Animated {
  readonly _tag: 'Group';
  readonly key: string;
  readonly children: ReadonlyArray<Node<Message>>;
}

export interface AmbientLight {
  readonly _tag: 'AmbientLight';
  readonly key: string;
  readonly color: number;
  readonly intensity: number;
}

export interface DirectionalLight extends Transform {
  readonly _tag: 'DirectionalLight';
  readonly key: string;
  readonly color: number;
  readonly intensity: number;
}

export type Node<Message> = Mesh<Message> | Group<Message> | AmbientLight | DirectionalLight;

export interface MeshOptions<Message> extends TransformOptions, AnimatedOptions {
  readonly key: string;
  readonly geometry: Geometry;
  readonly material: Material;
  readonly onClick?: Message;
}

export const mesh = <Message>(options: MeshOptions<Message>): Mesh<Message> => ({
  _tag: 'Mesh',
  key: options.key,
  geometry: options.geometry,
  material: options.material,
  onClick: options.onClick === undefined ? Option.none() : Option.some(options.onClick),
  ...transform(options),
  ...animated(options),
});

export interface GroupOptions<Message> extends TransformOptions, AnimatedOptions {
  readonly key: string;
  readonly children: ReadonlyArray<Node<Message>>;
}

export const group = <Message>(options: GroupOptions<Message>): Group<Message> => ({
  _tag: 'Group',
  key: options.key,
  children: options.children,
  ...transform(options),
  ...animated(options),
});

export interface LightOptions {
  readonly key: string;
  readonly color?: number;
  readonly intensity?: number;
}

export const ambientLight = (options: LightOptions): AmbientLight => ({
  _tag: 'AmbientLight',
  key: options.key,
  color: options.color ?? 0xffffff,
  intensity: options.intensity ?? 1,
});

export const directionalLight = (options: LightOptions & TransformOptions): DirectionalLight => ({
  _tag: 'DirectionalLight',
  key: options.key,
  color: options.color ?? 0xffffff,
  intensity: options.intensity ?? 1,
  ...transform(options),
});

// Camera

export interface PerspectiveCamera {
  readonly _tag: 'PerspectiveCamera';
  readonly position: Vector3;
  readonly rotation: Vector3;
  /** Vertical field of view in degrees. */
  readonly fov: number;
  readonly near: number;
  readonly far: number;
}

export interface PerspectiveCameraOptions {
  readonly position?: Vector3;
  readonly rotation?: Vector3;
  readonly fov?: number;
  readonly near?: number;
  readonly far?: number;
}

export const perspectiveCamera = (options: PerspectiveCameraOptions): PerspectiveCamera => ({
  _tag: 'PerspectiveCamera',
  position: options.position ?? [0, 0, 0],
  rotation: options.rotation ?? [0, 0, 0],
  fov: options.fov ?? 50,
  near: options.near ?? 0.1,
  far: options.far ?? 2000,
});

// Scene

export interface Scene<Message> {
  readonly camera: PerspectiveCamera;
  readonly nodes: ReadonlyArray<Node<Message>>;
  /** The Message a click produces when it hits no object at all. */
  readonly onClickNothing: Option.Option<Message>;
}

export interface SceneOptions<Message> {
  readonly camera: PerspectiveCamera;
  readonly nodes: ReadonlyArray<Node<Message>>;
  readonly onClickNothing?: Message;
}

export const scene = <Message>(options: SceneOptions<Message>): Scene<Message> => ({
  camera: options.camera,
  nodes: options.nodes,
  onClickNothing:
    options.onClickNothing === undefined ? Option.none() : Option.some(options.onClickNothing),
});
