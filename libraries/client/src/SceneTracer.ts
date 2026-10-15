import { Option } from 'effect';
import {
  Break,
  Fn,
  If,
  Loop,
  PI,
  abs,
  clamp,
  cos,
  cross,
  dot,
  float,
  getScreenPosition,
  getViewPosition,
  int,
  length,
  max,
  min,
  mix,
  normalize,
  pass,
  pow,
  reflect,
  screenCoordinate,
  select,
  sin,
  smoothstep,
  sqrt,
  storage,
  uint,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import * as Three from 'three/webgpu';
import * as Bvh from '#src/Bvh.ts';
import type * as RayTracing from '#src/RayTracing.ts';
import * as TracedScene from '#src/TracedScene.ts';

/**
 * A scene laid flat for rays, held on the graphics device, and the walk through it a shader takes: the same walk `TracedScene.trace` takes, threaded with no stack, in the shader's terms, so what it finds can be told against it. The buffers grow as the scene does, and are written again each frame the scene is laid flat anew; how many shapes are placed is a uniform, so a shader is built once for as long as the buffers fit.
 */

/** A buffer of four numbers at a time on the graphics device, grown as needed, which a shader reads. */
export interface Held {
  /** The shader's view of the buffer. */
  readonly node: Three.StorageBufferNode<'vec4'>;
  /** A view of the buffer a shader writes through, such as one posing a scene's shapes on the device. */
  readonly writable: Three.StorageBufferNode<'vec4'>;
  /** Writes `values` into the buffer from its start, growing it first if they do not fit: a grown buffer is a new one, which shaders reading it are built anew for. The very values written last are not written again, so what the device wrote over them stands. Says whether it grew. */
  readonly write: (values: Float32Array) => boolean;
}

/** A buffer room for `capacity` groups of four numbers, at least one. */
const attributeOf = (capacity: number) =>
  new Three.StorageBufferAttribute(new Float32Array(Math.max(capacity, 1) * 4), 4);

/** A buffer of four numbers at a time, room for `capacity` groups to begin with. */
export const held = (capacity: number): Held => {
  const kept: { attribute: Three.StorageBufferAttribute; last: Option.Option<Float32Array> } = {
    attribute: attributeOf(capacity),
    last: Option.none(),
  };
  const node = storage(kept.attribute, 'vec4', kept.attribute.count).toReadOnly();
  const writable = storage(kept.attribute, 'vec4', kept.attribute.count);
  return {
    node,
    writable,
    write: (values) => {
      if (Option.exists(kept.last, (last) => last === values)) {
        return false;
      }
      kept.last = Option.some(values);
      const needed = Math.ceil(values.length / 4);
      const grew = needed > kept.attribute.count;
      if (grew) {
        // Twice what is needed, so a scene that grows a little at a time is not moved each frame.
        kept.attribute = attributeOf(needed * 2);
        for (const view of [node, writable]) {
          view.value = kept.attribute;
          view.bufferCount = kept.attribute.count;
        }
      }
      kept.attribute.array.set(values);
      kept.attribute.needsUpdate = true;
      return grew;
    },
  };
};

/** The flat scene on the graphics device: its shapes' nodes, their triangles and what their corners say, the placed shapes, their nodes, and how many are placed. */
export interface OnDevice {
  readonly shapeNodes: Held;
  readonly triangles: Held;
  readonly corners: Held;
  readonly placed: Held;
  readonly placedNodes: Held;
  readonly placedCount: Three.UniformNode<'int', number>;
  /** Writes `flat` to the device, and says whether a buffer grew, so shaders reading them are built anew. */
  readonly write: (flat: TracedScene.Flat) => boolean;
}

/** A flat scene's buffers on the graphics device, empty to begin with. */
export const onDevice = (): OnDevice => {
  const shapeNodes = held(64);
  const triangles = held(256);
  const corners = held(256);
  const placed = held(64);
  const placedNodes = held(64);
  const placedCount = uniform(0, 'int');
  return {
    shapeNodes,
    triangles,
    corners,
    placed,
    placedNodes,
    placedCount,
    write: (flat) => {
      const grew = [
        shapeNodes.write(flat.shapeNodes),
        triangles.write(flat.triangles),
        corners.write(flat.corners),
        placed.write(flat.placed),
        placedNodes.write(flat.placedNodes),
      ].some(Boolean);
      placedCount.value = flat.placedCount;
      return grew;
    },
  };
};

/** The least a part of a ray's direction is taken as, so its inverse is never infinite. */
const LEAST = 1e-12;

/** `part`, or the least there is in its direction where it is less. */
const safe = (part: Three.Node<'float'>) =>
  select(abs(part).lessThan(LEAST), select(part.lessThan(0), float(-LEAST), float(LEAST)), part);

/** The inverse of each part of `direction`, a part of nothing taken as the least there is. */
const inverseOf = (direction: Three.Node<'vec3'>) =>
  vec3(1).div(vec3(safe(direction.x), safe(direction.y), safe(direction.z)));

/** Whether the ray from `origin`, its direction's inverse `invert`, meets the box from `least` to `greatest` before `far`. */
const entersBox = (
  least: Three.Node<'vec3'>,
  greatest: Three.Node<'vec3'>,
  origin: Three.Node<'vec3'>,
  invert: Three.Node<'vec3'>,
  far: Three.Node<'float'>,
) => {
  const low = least.sub(origin).mul(invert).toVar();
  const high = greatest.sub(origin).mul(invert).toVar();
  const near = max(max(min(low.x, high.x), min(low.y, high.y)), max(min(low.z, high.z), 0));
  const farthest = min(min(max(low.x, high.x), max(low.y, high.y)), min(max(low.z, high.z), far));
  return near.lessThanEqual(farthest);
};

/** How many groups of four numbers a threaded node takes on the device. */
const NODE_GROUPS = Bvh.THREADED / 4;

/** How many groups of four numbers a placed shape takes on the device. */
const PLACED_GROUPS = TracedScene.PLACED / 4;

/** How many groups of four numbers a triangle takes on the device. */
const TRIANGLE_GROUPS = TracedScene.TRIANGLE / 4;

/** How far along the ray from `origin` going `direction`, as long as `direction` is, it meets the capsule about the line from `a` to `b`, `radius` round, as `TracedScene`'s walk works it out: along its side where the ray is not along the line itself, else the nearer of its round ends; far beyond anything where it misses. */
const meetsLink = (
  a: Three.Node<'vec3'>,
  b: Three.Node<'vec3'>,
  radius: Three.Node<'float'>,
  origin: Three.Node<'vec3'>,
  direction: Three.Node<'vec3'>,
): Three.Node<'float'> => {
  const long = length(direction).max(LEAST);
  const way = direction.div(long);
  const ba = b.sub(a);
  const oa = origin.sub(a);
  const baba = dot(ba, ba);
  const bard = dot(ba, way);
  const baoa = dot(ba, oa);
  const sideA = baba.sub(bard.mul(bard));
  const sideB = baba.mul(dot(way, oa)).sub(baoa.mul(bard));
  const sideC = baba.mul(dot(oa, oa)).sub(baoa.mul(baoa)).sub(radius.mul(radius).mul(baba));
  const side = sideB.mul(sideB).sub(sideA.mul(sideC));
  const t = sideB
    .negate()
    .sub(sqrt(side.max(0)))
    .div(sideA.max(LEAST));
  const along = baoa.add(t.mul(bard));
  const alongSide = select(
    sideA
      .greaterThan(LEAST)
      .and(side.greaterThanEqual(0))
      .and(along.greaterThan(0))
      .and(along.lessThan(baba)),
    t,
    float(MISSED),
  );
  const roundEnd = (end: Three.Node<'vec3'>) => {
    const from = origin.sub(end);
    const endB = dot(way, from);
    const round = endB.mul(endB).sub(dot(from, from).sub(radius.mul(radius)));
    return select(round.greaterThan(0), endB.negate().sub(sqrt(round.max(0))), float(MISSED));
  };
  return min(alongSide, min(roundEnd(a), roundEnd(b))).div(long);
};

/** How far a ray that misses a link is taken to meet it: beyond anything a walk is looking for. */
const MISSED = 1e30;

/** The walk `trace` takes, as it ends: how far along the ray it met something, which placed shape, -1 for none, which of the triangles or links it met, by its place among them, and the ray as it was in that shape's own space. */
const walk = (
  device: OnDevice,
  origin: Three.Node<'vec3'>,
  direction: Three.Node<'vec3'>,
  far: Three.Node<'float'>,
  seeking: TracedScene.Meets,
) => {
  const best = float(far).toVar();
  const hit = int(-1).toVar();
  const item = int(0).toVar();
  const metFrom = vec3(0).toVar();
  const metAlong = vec3(0).toVar();
  const invert = inverseOf(direction).toVar();
  const node = select(device.placedCount.greaterThan(0), int(0), int(-1)).toVar();
  Loop(() => {
    If(node.equal(-1), () => {
      Break();
    });
    const lower = device.placedNodes.node.element(node.mul(NODE_GROUPS)).toVar();
    const upper = device.placedNodes.node.element(node.mul(NODE_GROUPS).add(1)).toVar();
    const after = int(lower.w).toVar();
    const count = int(upper.w).toVar();
    If(entersBox(lower.xyz, upper.xyz, origin, invert, best).not(), () => {
      node.assign(after);
    })
      .ElseIf(count.equal(0), () => {
        node.addAssign(1);
      })
      .Else(() => {
        const first = int(device.placedNodes.node.element(node.mul(NODE_GROUPS).add(2)).x).toVar();
        const placed = first.toVar();
        Loop(() => {
          If(placed.greaterThanEqual(first.add(count)), () => {
            Break();
          });
          const base = placed.mul(PLACED_GROUPS).toVar();
          const row0 = device.placed.node.element(base).toVar();
          const row1 = device.placed.node.element(base.add(1)).toVar();
          const row2 = device.placed.node.element(base.add(2)).toVar();
          const localOrigin = vec3(
            dot(row0.xyz, origin).add(row0.w),
            dot(row1.xyz, origin).add(row1.w),
            dot(row2.xyz, origin).add(row2.w),
          ).toVar();
          const localDirection = vec3(
            dot(row0.xyz, direction),
            dot(row1.xyz, direction),
            dot(row2.xyz, direction),
          ).toVar();
          const localInvert = inverseOf(localDirection).toVar();
          const root = int(device.placed.node.element(base.add(3)).w);
          // Traced for a shadow, a shape that casts none is passed by: its walk ends before it begins.
          const shapeNode = (
            seeking === 'Casting'
              ? select(device.placed.node.element(base.add(4)).w.greaterThan(0.5), root, int(-1))
              : root
          ).toVar();
          Loop(() => {
            If(shapeNode.equal(-1), () => {
              Break();
            });
            const low = device.shapeNodes.node.element(shapeNode.mul(NODE_GROUPS)).toVar();
            const high = device.shapeNodes.node.element(shapeNode.mul(NODE_GROUPS).add(1)).toVar();
            const shapeAfter = int(low.w).toVar();
            const triangles = int(high.w).toVar();
            If(entersBox(low.xyz, high.xyz, localOrigin, localInvert, best).not(), () => {
              shapeNode.assign(shapeAfter);
            })
              .ElseIf(triangles.equal(0), () => {
                shapeNode.addAssign(1);
              })
              .Else(() => {
                const firstTriangle = int(
                  device.shapeNodes.node.element(shapeNode.mul(NODE_GROUPS).add(2)).x,
                ).toVar();
                const triangle = firstTriangle.toVar();
                Loop(() => {
                  If(triangle.greaterThanEqual(firstTriangle.add(triangles)), () => {
                    Break();
                  });
                  const at = triangle.mul(TRIANGLE_GROUPS).toVar();
                  const first4 = device.triangles.node.element(at).toVar();
                  const a = first4.xyz.toVar();
                  If(first4.w.greaterThan(0.5), () => {
                    // A link of a strand: a capsule about the line from its start to its end.
                    const second = device.triangles.node.element(at.add(1)).toVar();
                    const t = meetsLink(
                      a,
                      second.xyz,
                      second.w,
                      localOrigin,
                      localDirection,
                    ).toVar();
                    If(t.greaterThan(TracedScene.NEAREST).and(t.lessThan(best)), () => {
                      best.assign(t);
                      hit.assign(placed);
                      item.assign(triangle);
                      metFrom.assign(localOrigin);
                      metAlong.assign(localDirection);
                    });
                  }).Else(() => {
                    const e1 = device.triangles.node.element(at.add(1)).xyz.sub(a).toVar();
                    const e2 = device.triangles.node.element(at.add(2)).xyz.sub(a).toVar();
                    const p = cross(localDirection, e2).toVar();
                    const determinant = dot(e1, p).toVar();
                    If(abs(determinant).greaterThanEqual(LEAST), () => {
                      const scale = float(1).div(determinant).toVar();
                      const s = localOrigin.sub(a).toVar();
                      const u = dot(s, p).mul(scale).toVar();
                      const q = cross(s, e1).toVar();
                      const v = dot(localDirection, q).mul(scale).toVar();
                      const t = dot(e2, q).mul(scale).toVar();
                      If(
                        u
                          .greaterThanEqual(0)
                          .and(v.greaterThanEqual(0))
                          .and(u.add(v).lessThanEqual(1))
                          .and(t.greaterThan(TracedScene.NEAREST))
                          .and(t.lessThan(best)),
                        () => {
                          best.assign(t);
                          hit.assign(placed);
                          item.assign(triangle);
                          metFrom.assign(localOrigin);
                          metAlong.assign(localDirection);
                        },
                      );
                    });
                  });
                  triangle.addAssign(1);
                });
                shapeNode.assign(shapeAfter);
              });
          });
          placed.addAssign(1);
        });
        node.assign(after);
      });
  });
  return { best, hit, item, metFrom, metAlong };
};

/**
 * The walk a shader takes through `device` for the ray from `origin` going `direction`, before `far`: what it meets first of what it is `seeking`, as how far along it in `x` and which placed shape in `y`, -1 where it meets nothing. Built where it is called, into the shader calling it: the same walk as `TracedScene.trace`, the top hierarchy threaded to each shape whose box the ray meets, and that shape's, in its own space, to the triangles.
 */
export const trace = (
  device: OnDevice,
  origin: Three.Node<'vec3'>,
  direction: Three.Node<'vec3'>,
  far: Three.Node<'float'>,
  seeking: TracedScene.Meets = 'Anything',
): Three.Node<'vec2'> => {
  const { best, hit } = walk(device, origin, direction, far, seeking);
  return vec2(best, float(hit));
};

/** What the ray from `origin` going `direction` meets first in `device` before `far`, as `trace` finds it, which way its surface faces there, in the scene, of length one, turned back toward where the ray came from, where it lies in the picture that paints it, which way a strand it meets runs, root toward tip, or nothing for a triangle, and which ways across a triangle its picture runs, across and down, or nothing where it has no picture, as `TracedScene.trace` works them out: weighed between what the corners of the triangle it meets say, where they say it, and as the triangle itself faces where they do not; up and nowhere where it meets nothing. */
export const traceFacing = (
  device: OnDevice,
  origin: Three.Node<'vec3'>,
  direction: Three.Node<'vec3'>,
  far: Three.Node<'float'>,
): {
  readonly met: Three.Node<'vec2'>;
  readonly normal: Three.Node<'vec3'>;
  readonly uv: Three.Node<'vec2'>;
  readonly along: Three.Node<'vec3'>;
  readonly across: Three.Node<'vec3'>;
  readonly down: Three.Node<'vec3'>;
} => {
  const { best, hit, item, metFrom, metAlong } = walk(device, origin, direction, far, 'Anything');
  const at = item.mul(TRIANGLE_GROUPS);
  const first = device.triangles.node.element(at);
  const a = first.xyz;
  const b = device.triangles.node.element(at.add(1)).xyz;
  const c = device.triangles.node.element(at.add(2)).xyz;
  const point = metFrom.add(metAlong.mul(best));
  const ba = b.sub(a);
  const ca = c.sub(a);
  const share = clamp(dot(point.sub(a), ba).div(dot(ba, ba).max(LEAST)), 0, 1);
  // What the corners say: which way each faces, the picture's places in the fourths and the last group, and whether they say it.
  const said = item.mul(TracedScene.CORNERS / 4);
  const n0 = device.corners.node.element(said);
  const n1 = device.corners.node.element(said.add(1));
  const n2 = device.corners.node.element(said.add(2));
  const rest = device.corners.node.element(said.add(3));
  const smooth = rest.w.greaterThan(0.5).and(first.w.lessThan(0.5));
  // How much each corner weighs where the ray met the triangle.
  const towards = point.sub(a);
  const d00 = dot(ba, ba);
  const d01 = dot(ba, ca);
  const d11 = dot(ca, ca);
  const d20 = dot(towards, ba);
  const d21 = dot(towards, ca);
  const below = d00.mul(d11).sub(d01.mul(d01)).toVar();
  const second = select(below.equal(0), float(0), d11.mul(d20).sub(d01.mul(d21)).div(below));
  const third = select(below.equal(0), float(0), d00.mul(d21).sub(d01.mul(d20)).div(below));
  const weight = float(1).sub(second).sub(third);
  const weighed = n0.xyz.mul(weight).add(n1.xyz.mul(second)).add(n2.xyz.mul(third));
  const local = select(
    first.w.greaterThan(0.5),
    point.sub(a).sub(ba.mul(share)),
    select(smooth, weighed, cross(ba, ca)),
  );
  const uv = select(
    smooth,
    vec2(
      n0.w.mul(weight).add(n2.w.mul(second)).add(rest.y.mul(third)),
      n1.w.mul(weight).add(rest.x.mul(second)).add(rest.z.mul(third)),
    ),
    vec2(0),
  );
  // Into the scene by the transpose of the rows that turn the scene into the shape's space.
  const base = select(hit.greaterThanEqual(0), hit, int(0)).mul(PLACED_GROUPS);
  const row0 = device.placed.node.element(base).xyz;
  const row1 = device.placed.node.element(base.add(1)).xyz;
  const row2 = device.placed.node.element(base.add(2)).xyz;
  const turned = normalize(row0.mul(local.x).add(row1.mul(local.y)).add(row2.mul(local.z)));
  const facing = select(dot(turned, direction).greaterThan(0), turned.negate(), turned);
  // A way into the scene by what places it: the inverse of the rows, by their cross products, its determinant keeping which way it runs.
  const determinant = dot(row0, cross(row1, row2));
  const intoScene = (way: Three.Node<'vec3'>) =>
    normalize(
      cross(row1, row2)
        .mul(way.x)
        .add(cross(row2, row0).mul(way.y))
        .add(cross(row0, row1).mul(way.z)),
    ).mul(select(determinant.lessThan(0), float(-1), float(1)));
  const runs = intoScene(ba);
  // Which ways across the triangle its picture runs, across and down: as Three works them out where a mesh holds no tangents.
  const acrossPicture = vec2(n2.w.sub(n0.w), rest.y.sub(n0.w)).toVar();
  const downPicture = vec2(rest.x.sub(n1.w), rest.z.sub(n1.w)).toVar();
  const area = acrossPicture.x.mul(downPicture.y).sub(acrossPicture.y.mul(downPicture.x)).toVar();
  const pictured = smooth.and(first.w.lessThan(0.5)).and(area.abs().greaterThan(1e-12));
  const perArea = float(1).div(select(area.abs().greaterThan(1e-12), area, float(1)));
  const acrossWay = ba.mul(downPicture.y).sub(ca.mul(downPicture.x)).mul(perArea);
  const downWay = ca.mul(acrossPicture.x).sub(ba.mul(acrossPicture.y)).mul(perArea);
  return {
    met: vec2(best, float(hit)),
    normal: select(hit.greaterThanEqual(0), facing, vec3(0, 1, 0)),
    uv: select(hit.greaterThanEqual(0), uv, vec2(0)),
    along: select(hit.greaterThanEqual(0).and(first.w.greaterThan(0.5)), runs, vec3(0)),
    across: select(hit.greaterThanEqual(0).and(pictured), intoScene(acrossWay), vec3(0)),
    down: select(hit.greaterThanEqual(0).and(pictured), intoScene(downWay), vec3(0)),
  };
};

/** What a frame drew that tracing reads: its picture, its depth, its surfaces' directions in the camera's space, a picture of how rough they are in its `a`, and one of their colours with how metal they are in its `a`. */
export interface Drawn {
  readonly picture: Three.TextureNode;
  readonly depth: Three.TextureNode;
  readonly normal: (at: Three.Node<'vec2'>) => Three.Node<'vec3'>;
  readonly surfaces: Three.TextureNode;
  readonly diffuse: Three.TextureNode;
}

/** The camera's matrices as uniforms that follow it: from its space into the scene's and back, and its projection and that's inverse. */
const cameraOf = (camera: Three.PerspectiveCamera) => ({
  world: uniform(camera.matrixWorld),
  view: uniform(camera.matrixWorldInverse),
  projection: uniform(camera.projectionMatrix),
  projectionInverse: uniform(camera.projectionMatrixInverse),
});

/** `seed` scrambled so that neighbouring seeds give unrelated numbers, by the PCG hash: graphics hardware keeps no better randomness, and a hash of a sine, as many shaders use, repeats across neighbouring pixels in single precision. */
const scrambled = (seed: Three.Node<'uint'>) => {
  const state = seed.mul(uint(747796405)).add(uint(2891336453)).toVar();
  const word = state
    .shiftRight(state.shiftRight(uint(28)).add(uint(4)))
    .bitXor(state)
    .mul(uint(277803737))
    .toVar();
  return word.shiftRight(uint(22)).bitXor(word);
};

/** A number from 0 to 1 for the pixel drawn, the frame, and which of its numbers `draw` asks for, unrelated to any other pixel's, frame's, or draw's. */
const randomOf = (frame: Three.Node<'uint'>, draw: Three.Node<'uint'>) => {
  const pixel = scrambled(uint(screenCoordinate.x)).add(uint(screenCoordinate.y));
  return float(scrambled(scrambled(scrambled(pixel).add(frame)).add(draw))).div(4294967295);
};

/** A direction about `normal`, as likely as light arriving from it lights a surface facing `normal`: more often near it, seldom along the surface; from two numbers from 0 to 1. */
const cosineAbout = (
  normal: Three.Node<'vec3'>,
  first: Three.Node<'float'>,
  second: Three.Node<'float'>,
) => {
  const up = select(abs(normal.z).lessThan(0.999), vec3(0, 0, 1), vec3(1, 0, 0));
  const tangent = normalize(cross(up, normal)).toVar();
  const bitangent = cross(normal, tangent).toVar();
  const turn = first.mul(PI.mul(2)).toVar();
  const across = sqrt(second).toVar();
  return normalize(
    tangent
      .mul(cos(turn).mul(across))
      .add(bitangent.mul(sin(turn).mul(across)))
      .add(normal.mul(sqrt(float(1).sub(second)))),
  );
};

/** How many numbers each direct light takes: where it shines from and its kind, its colour as bright as it shines and how far it reaches, the way toward it and how it falls off, and its cone. */
export const LIGHT = 16;

/** The kinds of direct light, as a shader tells them apart. */
const POINT = 0;
const SPOT = 1;
const DIRECTIONAL = 2;

const lightPosition = new Three.Vector3();
const lightTarget = new Three.Vector3();
const lightToward = new Three.Vector3();

/**
 * The direct lights of `scene` that ray tracing shadows, laid flat for a shader: every point, spot, and directional light drawn and shining, but those Three.js shadows with a shadow map, which are left to their maps. Each is where it shines from, its kind, its colour times its intensity, how far it reaches, the way toward it from where it points, for a spot or the sun, how its light falls off, and a spot's cone, as the cosines of its edge and of where its penumbra begins.
 */
export const directLights = (scene: Three.Scene): Float32Array => {
  const laid: Array<number> = [];
  scene.traverseVisible((object) => {
    if (
      !(
        object instanceof Three.PointLight ||
        object instanceof Three.SpotLight ||
        object instanceof Three.DirectionalLight
      ) ||
      object.castShadow ||
      object.intensity <= 0
    ) {
      return;
    }
    object.getWorldPosition(lightPosition);
    const pointed =
      object instanceof Three.PointLight
        ? lightToward.set(0, 0, 0)
        : lightToward
            .copy(lightPosition)
            .sub(object.target.getWorldPosition(lightTarget))
            .normalize();
    laid.push(
      lightPosition.x,
      lightPosition.y,
      lightPosition.z,
      object instanceof Three.PointLight
        ? POINT
        : object instanceof Three.SpotLight
          ? SPOT
          : DIRECTIONAL,
      object.color.r * object.intensity,
      object.color.g * object.intensity,
      object.color.b * object.intensity,
      object instanceof Three.DirectionalLight ? 0 : object.distance,
      pointed.x,
      pointed.y,
      pointed.z,
      object instanceof Three.DirectionalLight ? 0 : object.decay,
      object instanceof Three.SpotLight ? Math.cos(object.angle) : 0,
      object instanceof Three.SpotLight ? Math.cos(object.angle * (1 - object.penumbra)) : 0,
      0,
      0,
    );
  });
  return new Float32Array(laid);
};

/** How the scene is traced each frame: gathered and written to the device, and the passes that trace it, light and reflections as told. */
export interface Tracing {
  /** Gathers the scene as it is now and writes it to the device: once a frame, before the passes draw. */
  readonly sync: () => void;
  /** Indirect light in `rgb`, how much of the ambient light reaches a surface in `a`. */
  readonly light: Option.Option<Three.PassNode>;
  /** What a surface reflects in `rgb`, weighed by how strongly it does, to be added to what it shows. */
  readonly reflections: Option.Option<Three.PassNode>;
  /** The direct light kept from each surface by what casts a shadow between it and a light, in `rgb`, to be taken from what it shows. */
  readonly shadows: Option.Option<Three.PassNode>;
  readonly dispose: () => void;
}

/** A full-screen pass drawing `colour` at `resolution` of the canvas's, a picture of four numbers a pixel at half precision. */
const fullScreen = (colour: Three.Node<'vec4'>, resolution: number) => {
  const material = new Three.NodeMaterial();
  material.fragmentNode = colour;
  material.depthTest = false;
  material.depthWrite = false;
  const quad = new Three.QuadMesh(material);
  const drawn = pass(quad, quad.camera, { samples: 0, depthBuffer: false });
  drawn.setResolutionScale(resolution);
  drawn.getTexture('output').type = Three.HalfFloatType;
  return { drawn, material };
};

/**
 * `scene` traced from `camera` through its own triangles, as `told`, reading what each frame `drawn`: indirect light, from `told.rays` rays a pixel cast about each surface as far as the light's radius, what they meet lighting it as it is lit itself; and reflections, from a ray a pixel along the reflection, turned aside as far as the surface is rough.
 */
export const tracing = (
  scene: Three.Scene,
  camera: Three.PerspectiveCamera,
  drawn: Drawn,
  told: RayTracing.Scene,
): Tracing => {
  const device = onDevice();
  const gathering = TracedScene.gathering();
  const ambient = uniform(new Three.Color(0, 0, 0));
  const frame = uniform(0, 'uint');
  // How many pixels the frame drawn is across and up, as it was drawn last.
  const drawnSize = uniform(new Three.Vector2(1, 1));
  // The direct lights it shadows, and how many there are.
  const directs = held(16);
  const directCount = uniform(0, 'int');
  const view = cameraOf(camera);
  const lights = new Three.Color();

  /** What lights the point `point` the ray met on placed shape `placed`: as drawn where the point is on the screen and nothing hides it, else its colour in the ambient light, and the light it gives off. */
  const lightAt = (point: Three.Node<'vec3'>, placed: Three.Node<'int'>) => {
    const inView = view.view.mul(vec4(point, 1)).xyz.toVar();
    const at = getScreenPosition(inView, view.projection).toVar();
    const onScreen = at.x
      .greaterThanEqual(0)
      .and(at.x.lessThanEqual(1))
      .and(at.y.greaterThanEqual(0))
      .and(at.y.lessThanEqual(1))
      .and(inView.z.lessThan(0));
    const drawnDepth = drawn.depth.sample(at).level(int(0)).r;
    const drawnAt = getViewPosition(at, drawnDepth, view.projectionInverse);
    const shown = onScreen.and(
      abs(drawnAt.z.sub(inView.z)).lessThan(abs(inView.z).mul(0.03).add(0.05)),
    );
    const base = placed.mul(PLACED_GROUPS);
    const colour = device.placed.node.element(base.add(3)).xyz;
    const glow = device.placed.node.element(base.add(4)).xyz;
    return select(shown, drawn.picture.sample(at).level(int(0)).rgb, colour.mul(ambient).add(glow));
  };

  /** The middle of the pixel of the frame drawn that `at`, a point of this pass's own coarser picture, falls in: where a surface's depth and its place are read alike, so a surface seen at a slant is never placed behind itself. */
  const drawnPixelAt = (at: Three.Node<'vec2'>) =>
    at.mul(drawnSize).floor().add(0.5).div(drawnSize);

  /** Where the surface drawn at `at` is in the scene, which way it faces there, and where a ray leaving it starts, a little off it so it does not meet itself. */
  const surfaceAt = (at: Three.Node<'vec2'>, depth: Three.Node<'float'>) => {
    const inView = getViewPosition(at, depth, view.projectionInverse).toVar();
    const position = view.world.mul(vec4(inView, 1)).xyz.toVar();
    const normal = normalize(view.world.mul(vec4(drawn.normal(at), 0)).xyz).toVar();
    const origin = position.add(normal.mul(abs(inView.z).mul(0.002).add(0.002))).toVar();
    return { inView, position, normal, origin };
  };

  const light = Option.map(told.light, ({ strength, occlusion, radius }) => {
    const shade = Fn(() => {
      const at = drawnPixelAt(uv()).toVar();
      const depth = drawn.depth.sample(at).r.toVar();
      const result = vec4(0, 0, 0, 1).toVar();
      If(depth.lessThan(1), () => {
        const { origin, normal } = surfaceAt(at, depth);
        const occluded = float(0).toVar();
        const gathered = vec3(0).toVar();
        Loop(told.rays, ({ i }) => {
          const draw = uint(i).mul(uint(2));
          const direction = cosineAbout(
            normal,
            randomOf(frame, draw),
            randomOf(frame, draw.add(uint(1))),
          ).toVar();
          const met = trace(device, origin, direction, float(radius)).toVar();
          If(met.y.greaterThanEqual(0), () => {
            // What lies near shades far more than what lies across the room: the nearer, the more, falling away to nothing at the radius.
            const away = float(1).sub(met.x.div(radius));
            occluded.addAssign(away.mul(away));
            gathered.addAssign(lightAt(origin.add(direction.mul(met.x)), int(met.y)));
          });
        });
        const reaching = max(float(1).sub(occluded.div(told.rays).mul(occlusion)), 0);
        result.assign(vec4(gathered.div(told.rays).mul(strength), reaching));
      });
      return result;
    })();
    return fullScreen(shade, told.resolution);
  });

  const reflections = Option.map(told.reflections, ({ strength, distance }) => {
    const shade = Fn(() => {
      const at = drawnPixelAt(uv()).toVar();
      const depth = drawn.depth.sample(at).r.toVar();
      const result = vec4(0).toVar();
      If(depth.lessThan(1), () => {
        const { origin, normal, position } = surfaceAt(at, depth);
        const coloured = drawn.diffuse.sample(at).level(int(0)).toVar();
        const rough = drawn.surfaces.sample(at).level(int(0)).a.toVar();
        const toward = normalize(position.sub(view.world.mul(vec4(0, 0, 0, 1)).xyz)).toVar();
        const mirrored = reflect(toward, normal).toVar();
        // Rougher, the reflection is turned further aside, toward any direction about the surface.
        const direction = normalize(
          mix(
            mirrored,
            cosineAbout(normal, randomOf(frame, uint(64)), randomOf(frame, uint(65))),
            rough.mul(rough),
          ),
        ).toVar();
        const met = trace(device, origin, direction, float(distance)).toVar();
        If(met.y.greaterThanEqual(0), () => {
          const facing = max(dot(toward.negate(), normal), 0);
          const base = mix(vec3(0.04), coloured.rgb, coloured.a).toVar();
          const fresnel = base.add(
            vec3(1)
              .sub(base)
              .mul(pow(float(1).sub(facing), 5)),
          );
          // Weighed by how much a surface facing so reflects, and less the rougher it is, as Three's screen-space reflections are, to be added to what it shows.
          const weight = fresnel.mul(float(1).sub(rough)).mul(strength);
          result.assign(vec4(lightAt(origin.add(direction.mul(met.x)), int(met.y)).mul(weight), 1));
        });
      });
      return result;
    })();
    return fullScreen(shade, told.resolution);
  });

  const shadows = Option.map(told.shadows, ({ strength }) => {
    const shade = Fn(() => {
      const at = drawnPixelAt(uv()).toVar();
      const depth = drawn.depth.sample(at).r.toVar();
      const kept = vec3(0).toVar();
      If(depth.lessThan(1), () => {
        const { origin, normal, position } = surfaceAt(at, depth);
        const coloured = drawn.diffuse.sample(at).level(int(0)).toVar();
        // What the surface scatters of the light falling on it, as Three.js lights it: its colour, less as it is metal.
        const scattered = coloured.rgb.mul(float(1).sub(coloured.a)).div(PI).toVar();
        Loop(directCount, ({ i }) => {
          const base = i.mul(LIGHT / 4).toVar();
          const where = directs.node.element(base).toVar();
          const shine = directs.node.element(base.add(1)).toVar();
          const pointed = directs.node.element(base.add(2)).toVar();
          const cone = directs.node.element(base.add(3)).toVar();
          const kind = int(where.w).toVar();
          const toward = where.xyz.sub(position).toVar();
          const away = toward.length().toVar();
          const direction = select(kind.equal(DIRECTIONAL), pointed.xyz, toward.div(away)).toVar();
          // How it falls off with distance, as Three.js has it fall off, and none for the sun.
          const falloff = float(1)
            .div(max(away.pow(pointed.w), 0.01))
            .toVar();
          const cutoff = select(
            shine.w.greaterThan(0),
            falloff.mul(float(1).sub(away.div(shine.w).pow(4)).clamp(0, 1).pow(2)),
            falloff,
          );
          const spot = select(
            kind.equal(SPOT),
            smoothstep(cone.x, cone.y, dot(direction, pointed.xyz)),
            float(1),
          );
          const reaching = select(kind.equal(DIRECTIONAL), float(1), cutoff.mul(spot));
          const falling = shine.xyz
            .mul(reaching)
            .mul(max(dot(normal, direction), 0))
            .mul(scattered)
            .toVar();
          If(max(falling.x, max(falling.y, falling.z)).greaterThan(1e-4), () => {
            const far = select(kind.equal(DIRECTIONAL), float(1e4), away.sub(0.05));
            const met = trace(device, origin, direction, far, 'Casting');
            If(met.y.greaterThanEqual(0), () => {
              kept.addAssign(falling);
            });
          });
        });
      });
      return vec4(kept.mul(strength), 1);
    })();
    // A shadow's edge is sharp: it is traced at the whole resolution.
    return fullScreen(shade, 1);
  });

  const passes = [
    ...Option.toArray(light),
    ...Option.toArray(reflections),
    ...Option.toArray(shadows),
  ];
  return {
    sync: () => {
      const flat = gathering.gather(scene, camera);
      const shining = directLights(scene);
      const grew = [device.write(flat), directs.write(shining)].some(Boolean);
      if (grew) {
        // A grown buffer is a new one: the passes reading it are built again for it.
        for (const { material } of passes) material.needsUpdate = true;
      }
      directCount.value = shining.length / LIGHT;
      // What lights a surface off the screen: the scene's ambient and hemisphere lights, the hemisphere's sky and ground alike.
      lights.setRGB(0, 0, 0);
      scene.traverseVisible((object) => {
        if (object instanceof Three.AmbientLight) {
          lights.r += object.color.r * object.intensity;
          lights.g += object.color.g * object.intensity;
          lights.b += object.color.b * object.intensity;
        } else if (object instanceof Three.HemisphereLight) {
          lights.r += ((object.color.r + object.groundColor.r) / 2) * object.intensity;
          lights.g += ((object.color.g + object.groundColor.g) / 2) * object.intensity;
          lights.b += ((object.color.b + object.groundColor.b) / 2) * object.intensity;
        }
      });
      ambient.value.copy(lights);
      drawnSize.value.set(drawn.depth.value.width, drawn.depth.value.height);
      frame.value = (frame.value + 1) % 65536;
    },
    light: Option.map(light, ({ drawn: traced }) => traced),
    reflections: Option.map(reflections, ({ drawn: traced }) => traced),
    shadows: Option.map(shadows, ({ drawn: traced }) => traced),
    dispose: () => {
      for (const { drawn: traced, material } of passes) {
        traced.dispose();
        material.dispose();
      }
    },
  };
};
