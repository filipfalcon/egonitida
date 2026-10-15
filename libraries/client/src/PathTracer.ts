import { Option } from 'effect';
import * as Three from 'three/webgpu';
import * as HairScattering from '#src/HairScattering.ts';
import * as TracedScene from '#src/TracedScene.ts';

/**
 * Light worked out by following paths, as light travels back from the eye: each path bounces off what it meets, as much of the light as each surface sends back carried on, until it leaves for the sky, glows, or fades. At every bounce each sun is asked for directly, a ray toward it telling whether it is hidden, and the next bounce is chosen as a matte surface scatters light, so a path's every sample is as likely as the light it carries. A photograph made of many such paths, averaged, is what the scene looks like; `radiance` follows one, here as the graphics device follows one for every pixel, so what the device finds can be told against it.
 */

/** A colour, or an amount of light, red, green, and blue. */
export type Colour = readonly [number, number, number];

/** A point, or a direction. */
export type Point = readonly [number, number, number];

/** A sun: the way toward it, of length one, and how much light it shines on a surface square to it. */
export interface Sun {
  readonly toward: Point;
  readonly irradiance: Colour;
}

/** The light about a scene: the sky's, as bright as `up` straight up and `down` straight down, and between them as far up as a way looks, as Three's hemisphere light has it; and each sun's. */
export interface Lighting {
  readonly up: Colour;
  readonly down: Colour;
  readonly suns: ReadonlyArray<Sun>;
}

/** How bright the sky of `lighting` is, looked at the way `way`, of length one. */
export const skyAt = (lighting: Lighting, way: Point): Colour => {
  const share = 0.5 + 0.5 * way[1];
  return [
    lighting.down[0] + (lighting.up[0] - lighting.down[0]) * share,
    lighting.down[1] + (lighting.up[1] - lighting.down[1]) * share,
    lighting.down[2] + (lighting.up[2] - lighting.down[2]) * share,
  ];
};

/** How many times a path bounces at most, and from how many bounces on it may fade, as likely as it is dark: so many that light bounced among strands of hair, or between walls, is all but never cut short, while fading ends most paths long before. */
const BOUNCES = 32;
const FADING = 3;

/** How far from a surface a path leaves it, so it does not meet the surface it left. */
const AWAY = 1e-4;

/** How far a ray looks for what it meets. */
const FAR = 1e6;

/** A direction about `normal`, of length one, as likely as its cosine to it: as a matte surface scatters light. */
const scattered = (normal: Point, random: () => number): Point => {
  const angle = 2 * Math.PI * random();
  const rise = random();
  const across = Math.sqrt(1 - rise);
  const up = Math.sqrt(rise);
  // Two ways square to the normal and to each other.
  const helper: Point = Math.abs(normal[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0];
  const firstRaw: Point = [
    helper[1] * normal[2] - helper[2] * normal[1],
    helper[2] * normal[0] - helper[0] * normal[2],
    helper[0] * normal[1] - helper[1] * normal[0],
  ];
  const firstLong = Math.hypot(...firstRaw);
  const first: Point = [firstRaw[0] / firstLong, firstRaw[1] / firstLong, firstRaw[2] / firstLong];
  const second: Point = [
    normal[1] * first[2] - normal[2] * first[1],
    normal[2] * first[0] - normal[0] * first[2],
    normal[0] * first[1] - normal[1] * first[0],
  ];
  const x = Math.cos(angle) * across;
  const y = Math.sin(angle) * across;
  return [
    first[0] * x + second[0] * y + normal[0] * up,
    first[1] * x + second[1] * y + normal[1] * up,
    first[2] * x + second[2] * y + normal[2] * up,
  ];
};

/** A strand of hair met by a ray going `way`, at the placed shape whose numbers start at `base`, running `along`, its surface facing `normal`: the strand ready to scatter light, the way it is seen from in its own frame, and how a way turns into that frame and back. */
const fibreAt = (flat: TracedScene.Flat, base: number, along: Point, normal: Point, way: Point) => {
  const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const seenWorld: Point = [-way[0], -way[1], -way[2]];
  const lengthwise = dot(seenWorld, along);
  const acrossRaw: Point = [
    seenWorld[0] - along[0] * lengthwise,
    seenWorld[1] - along[1] * lengthwise,
    seenWorld[2] - along[2] * lengthwise,
  ];
  const acrossLong = Math.hypot(...acrossRaw);
  // Seen straight along the strand, it is seen as its surface faces.
  const toward: Point =
    acrossLong > 1e-6
      ? [acrossRaw[0] / acrossLong, acrossRaw[1] / acrossLong, acrossRaw[2] / acrossLong]
      : normal;
  const side: Point = [
    toward[1] * along[2] - toward[2] * along[1],
    toward[2] * along[0] - toward[0] * along[2],
    toward[0] * along[1] - toward[1] * along[0],
  ];
  const local = (world: Point): HairScattering.Way => [
    dot(world, along),
    dot(world, side),
    dot(world, toward),
  ];
  return {
    prepared: HairScattering.prepare({
      offset: Math.min(Math.max(dot(normal, side), -1), 1),
      ior: flat.placed[base + 23] ?? 1.55,
      absorption: [
        flat.placed[base + 24] ?? 0,
        flat.placed[base + 25] ?? 0,
        flat.placed[base + 26] ?? 0,
      ],
      roughness: flat.placed[base + 21] ?? 0.3,
      radialRoughness: flat.placed[base + 22] ?? 0.3,
      tilt: flat.placed[base + 27] ?? 0,
    }),
    seen: local(seenWorld),
    local,
    world: (inFrame: HairScattering.Way): Point => [
      along[0] * inFrame[0] + side[0] * inFrame[1] + toward[0] * inFrame[2],
      along[1] * inFrame[0] + side[1] * inFrame[1] + toward[1] * inFrame[2],
      along[2] * inFrame[0] + side[2] * inFrame[1] + toward[2] * inFrame[2],
    ],
  };
};

/**
 * How much light reaches `origin` from the way `direction`, of length one, through `flat` lit by `lighting`, along one path whose bounces `random` chooses: what each surface met gives off, each sun it sees, matte, as much as Lambert has it, and the sky where the path leaves the scene, each carried back as much as the surfaces between send it on. From the fourth bounce a path fades as likely as it is dark, what remains of it carried on as much brighter, so no light is lost on average.
 */
export const radiance = (
  flat: TracedScene.Flat,
  origin: Point,
  direction: Point,
  lighting: Lighting,
  random: () => number,
): Colour => {
  const light = [0, 0, 0];
  const carried = [1, 1, 1];
  let from = origin;
  let way = direction;
  for (let bounce = 0; bounce < BOUNCES; bounce++) {
    const hit = Option.getOrUndefined(TracedScene.trace(flat, from, way, FAR));
    if (hit === undefined) {
      const sky = skyAt(lighting, way);
      for (let part = 0; part < 3; part++) {
        light[part] = (light[part] ?? 0) + (carried[part] ?? 0) * (sky[part] ?? 0);
      }
      break;
    }
    const base = hit.placed * TracedScene.PLACED;
    const colour: Colour = [
      flat.placed[base + 12] ?? 0,
      flat.placed[base + 13] ?? 0,
      flat.placed[base + 14] ?? 0,
    ];
    const glow: Colour = [
      flat.placed[base + 16] ?? 0,
      flat.placed[base + 17] ?? 0,
      flat.placed[base + 18] ?? 0,
    ];
    const { normal } = hit;
    const point: Point = [
      from[0] + way[0] * hit.distance,
      from[1] + way[1] * hit.distance,
      from[2] + way[2] * hit.distance,
    ];
    const hair = Option.filter(hit.along, () => (flat.placed[base + 20] ?? 0) === 1);
    if (Option.isSome(hair)) {
      for (let part = 0; part < 3; part++) {
        light[part] = (light[part] ?? 0) + (carried[part] ?? 0) * (glow[part] ?? 0);
      }
      const fibre = fibreAt(flat, base, hair.value, normal, way);
      for (const sun of lighting.suns) {
        // Light goes through a strand: it is lit from wherever a sun is not hidden.
        if (Option.isSome(TracedScene.trace(flat, point, sun.toward, FAR, 'Casting'))) {
          continue;
        }
        const sent = HairScattering.scattered(fibre.prepared, fibre.seen, fibre.local(sun.toward));
        for (let part = 0; part < 3; part++) {
          light[part] =
            (light[part] ?? 0) +
            (carried[part] ?? 0) * (sent[part] ?? 0) * (sun.irradiance[part] ?? 0);
        }
      }
      const chosen = HairScattering.sample(fibre.prepared, fibre.seen, [
        random(),
        random(),
        random(),
        random(),
      ]);
      for (let part = 0; part < 3; part++) {
        carried[part] = (carried[part] ?? 0) * (chosen.carried[part] ?? 0);
      }
      if (bounce >= FADING) {
        const keep = Math.min(Math.max(carried[0] ?? 0, carried[1] ?? 0, carried[2] ?? 0), 1);
        if (random() >= keep) {
          break;
        }
        for (let part = 0; part < 3; part++) {
          carried[part] = (carried[part] ?? 0) / keep;
        }
      }
      // On from where it met the strand, through it or away from it.
      from = point;
      way = fibre.world(chosen.way);
      continue;
    }
    const at: Point = [
      from[0] + way[0] * hit.distance + normal[0] * AWAY,
      from[1] + way[1] * hit.distance + normal[1] * AWAY,
      from[2] + way[2] * hit.distance + normal[2] * AWAY,
    ];
    for (let part = 0; part < 3; part++) {
      light[part] = (light[part] ?? 0) + (carried[part] ?? 0) * (glow[part] ?? 0);
    }
    for (const sun of lighting.suns) {
      const facing =
        normal[0] * sun.toward[0] + normal[1] * sun.toward[1] + normal[2] * sun.toward[2];
      if (facing <= 0 || Option.isSome(TracedScene.trace(flat, at, sun.toward, FAR, 'Casting'))) {
        continue;
      }
      for (let part = 0; part < 3; part++) {
        light[part] =
          (light[part] ?? 0) +
          ((carried[part] ?? 0) * (colour[part] ?? 0) * (sun.irradiance[part] ?? 0) * facing) /
            Math.PI;
      }
    }
    // Scattered as a matte surface scatters light: its cosine and the chance of choosing it cancel, leaving its colour.
    for (let part = 0; part < 3; part++) {
      carried[part] = (carried[part] ?? 0) * (colour[part] ?? 0);
    }
    if (bounce >= FADING) {
      const keep = Math.max(carried[0] ?? 0, carried[1] ?? 0, carried[2] ?? 0);
      if (random() >= keep) {
        break;
      }
      for (let part = 0; part < 3; part++) {
        carried[part] = (carried[part] ?? 0) / keep;
      }
    }
    from = at;
    way = scattered(normal, random);
  }
  return [light[0] ?? 0, light[1] ?? 0, light[2] ?? 0];
};

/** The light `scene` is lit by, as Three lights it, for a path: each hemisphere light its sky, as bright as its colour times its intensity over π, the radiance a surface's irradiance from it comes of; and each directional light a sun, toward where it stands from where it points, as much light on a surface square to it as its colour times its intensity. */
export const lightingOf = (scene: Three.Scene): Lighting => {
  const up = [0, 0, 0];
  const down = [0, 0, 0];
  const suns: Array<Sun> = [];
  scene.updateMatrixWorld();
  scene.traverseVisible((object) => {
    if (object instanceof Three.HemisphereLight) {
      const scale = object.intensity / Math.PI;
      up[0] = (up[0] ?? 0) + object.color.r * scale;
      up[1] = (up[1] ?? 0) + object.color.g * scale;
      up[2] = (up[2] ?? 0) + object.color.b * scale;
      down[0] = (down[0] ?? 0) + object.groundColor.r * scale;
      down[1] = (down[1] ?? 0) + object.groundColor.g * scale;
      down[2] = (down[2] ?? 0) + object.groundColor.b * scale;
    }
    if (object instanceof Three.DirectionalLight) {
      const from = new Three.Vector3().setFromMatrixPosition(object.matrixWorld);
      const to = new Three.Vector3().setFromMatrixPosition(object.target.matrixWorld);
      const toward = from.sub(to).normalize();
      suns.push({
        toward: [toward.x, toward.y, toward.z],
        irradiance: [
          object.color.r * object.intensity,
          object.color.g * object.intensity,
          object.color.b * object.intensity,
        ],
      });
    }
  });
  return {
    up: [up[0] ?? 0, up[1] ?? 0, up[2] ?? 0],
    down: [down[0] ?? 0, down[1] ?? 0, down[2] ?? 0],
    suns,
  };
};
