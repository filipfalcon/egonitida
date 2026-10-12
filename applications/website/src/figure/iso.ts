/**
 * Isometric drawing for the website's figures: a camera that projects state points onto the page, and solids and lines on them as SVG path data. A solid is a floor outline extruded straight up, shaded in four tones by how its sides face the light, or a cone; everything is drawn back to front, so nearer parts hide farther ones.
 */

/** A point on the page. */
export type Flat = readonly [number, number];

/** A point in the state: `x` and `y` on the floor, `z` up. */
export type Point3 = readonly [number, number, number];

/** A point on the floor. */
export type Plane = readonly [number, number];

/** How the state is seen: where its origin lands on the page, how large a unit is, and the camera's turn about the vertical and its height above the floor, in degrees. */
export interface Projection {
  readonly origin: Flat;
  readonly scale: number;
  readonly azimuth: number;
  readonly elevation: number;
}

/** A rounded rectangle on the floor: its corner, width along `x`, depth along `y`, and corner radius. */
export interface Plan {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly d: number;
  readonly r: number;
}

/** A solid as paths: the paper that hides what is behind it, its sides in four tones from darkest to lightest, its top, the crease where top meets sides, a bevel inset on the top, and its outline. */
export interface SolidPaths {
  readonly fill: string;
  readonly shades: readonly [string, string, string, string];
  readonly top: string;
  readonly crease: string;
  readonly bevel: string;
  readonly outline: string;
}

const RADIANS = Math.PI / 180;
const UNIT = Math.sqrt(1.6);

const cameraOf = ({ scale, azimuth, elevation }: Projection) => {
  const a = azimuth * RADIANS;
  const e = elevation * RADIANS;
  return {
    sinA: Math.sin(a),
    cosA: Math.cos(a),
    sinE: Math.sin(e),
    cosE: Math.cos(e),
    k: scale * UNIT,
  };
};

/** Where `point` lands on the page. */
export const iso = ([x, y, z]: Point3, projection: Projection): Flat => {
  const { sinA, cosA, sinE, cosE, k } = cameraOf(projection);
  return [
    projection.origin[0] + (x * sinA - y * cosA) * k,
    projection.origin[1] + ((x * cosA + y * sinA) * sinE - z * cosE) * k,
  ];
};

/** How near `point` is to the viewer: the larger, the nearer, so sorting by it ascending draws back to front. */
export const depthOf = ([x, y, z]: Point3, projection: Projection): number => {
  const { sinA, cosA, sinE, cosE } = cameraOf(projection);
  return (x * cosA + y * sinA) * cosE + z * sinE;
};

const towardViewer = (projection: Projection): Plane => {
  const { sinA, cosA } = cameraOf(projection);
  return [cosA, sinA];
};

const tenth = (value: number) => {
  const text = (Math.round(value * 10) / 10).toFixed(1).replace(/\.0$/, '');
  return text === '-0' ? '0' : text;
};

/** The points as one path, closed or open. */
export const pathOf = (points: ReadonlyArray<Flat>, isClosed = false): string =>
  points.length === 0
    ? ''
    : points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${tenth(x)} ${tenth(y)}`).join('') +
      (isClosed ? 'Z' : '');

/** The outline of `plan`, `steps` points to a corner. */
export const roundedPlan = ({ x, y, w, d, r }: Plan, steps = 8): ReadonlyArray<Plane> => {
  const radius = Math.max(0, Math.min(r, w / 2, d / 2));
  const count = radius > 0 ? steps : 0;
  const corners: ReadonlyArray<readonly [number, number, number]> = [
    [x + w - radius, y + radius, -90],
    [x + w - radius, y + d - radius, 0],
    [x + radius, y + d - radius, 90],
    [x + radius, y + radius, 180],
  ];
  return corners.flatMap(([cx, cy, start]) =>
    Array.from({ length: count + 1 }, (_, step): Plane => {
      const angle = (start + (count > 0 ? (90 * step) / count : 45)) * RADIANS;
      return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
    }),
  );
};

/** A circle on the floor, as `steps` points. */
export const circleRing = (
  cx: number,
  cy: number,
  radius: number,
  steps = 40,
): ReadonlyArray<Plane> =>
  Array.from({ length: steps }, (_, step): Plane => {
    const angle = (step / steps) * Math.PI * 2;
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
  });

const signedArea = (points: ReadonlyArray<Plane>) =>
  points.reduce((area, [ax, ay], index) => {
    const [bx, by] = points[(index + 1) % points.length] ?? [ax, ay];
    return area + ax * by - bx * ay;
  }, 0) / 2;

const oriented = (points: ReadonlyArray<Flat>) =>
  signedArea(points) < 0 ? [...points].reverse() : points;

const cross = (o: Flat, a: Flat, b: Flat) =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** The convex hull of `points`, by the monotone chain. */
const hullOf = (points: ReadonlyArray<Flat>): ReadonlyArray<Flat> => {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length < 3) {
    return sorted;
  }
  const chain = (ordered: ReadonlyArray<Flat>) =>
    ordered.reduce<Array<Flat>>((kept, point) => {
      while (kept.length >= 2) {
        const before = kept[kept.length - 2];
        const last = kept[kept.length - 1];
        if (before === undefined || last === undefined || cross(before, last, point) > 0) {
          break;
        }
        kept.pop();
      }
      kept.push(point);
      return kept;
    }, []);
  return [...chain(sorted).slice(0, -1), ...chain([...sorted].reverse()).slice(0, -1)];
};

/** The unbroken runs of indices in a ring whose flag is `want`, each with the index after its last, so a run's points join up. */
const runsOf = (
  flags: ReadonlyArray<boolean>,
  want: boolean,
): ReadonlyArray<ReadonlyArray<number>> => {
  const count = flags.length;
  const start = flags.findIndex((flag, index) => flag !== flags[(index + count - 1) % count]);
  if (start < 0) {
    return flags[0] === want
      ? [Array.from({ length: count + 1 }, (_, index) => index % count)]
      : [];
  }
  const runs: Array<Array<number>> = [];
  let run: Array<number> = [];
  for (let step = 0; step < count; step++) {
    const index = (start + step) % count;
    if (flags[index] === want) {
      if (run.length === 0) {
        run.push(index);
      }
      run.push((index + 1) % count);
    } else if (run.length > 0) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length > 0) {
    runs.push(run);
  }
  return runs;
};

const at = <Value>(list: ReadonlyArray<Value>, index: number, fallback: Value): Value =>
  list[index] ?? fallback;

/** The outline `ring` extruded from `z` up by `height`, with a bevel `bevel` wide on its top when it has one. */
export const extrude = (
  ring: ReadonlyArray<Plane>,
  z: number,
  height: number,
  projection: Projection,
  bevel = 0,
): SolidPaths => {
  const count = ring.length;
  const isCounter = signedArea(ring) > 0;
  const [vx, vy] = towardViewer(projection);
  const { sinA, cosA } = cameraOf(projection);
  const normals = ring.map(([ax, ay], index): Plane => {
    const [bx, by] = at(ring, (index + 1) % count, [ax, ay]);
    const length = Math.hypot(bx - ax, by - ay) || 1;
    const [dx, dy] = [(bx - ax) / length, (by - ay) / length];
    return isCounter ? [dy, -dx] : [-dy, dx];
  });
  const facing = normals.map(([nx, ny]) => nx * vx + ny * vy > 1e-9);
  const top = ring.map(([x, y]) => iso([x, y, z + height], projection));
  const bottom = ring.map(([x, y]) => iso([x, y, z], projection));
  const topAt = (index: number) => at(top, index, [0, 0]);
  const bottomAt = (index: number) => at(bottom, index, [0, 0]);

  const outline = [
    ...runsOf(facing, false).map((run) => pathOf(run.map(topAt))),
    ...(height > 0 ? runsOf(facing, true).map((run) => pathOf(run.map(bottomAt))) : []),
    ...(height > 0
      ? ring.flatMap((_, index) =>
          facing[(index + count - 1) % count] !== facing[index]
            ? [pathOf([topAt(index), bottomAt(index)])]
            : [],
        )
      : []),
  ];
  const crease = runsOf(facing, true).map((run) => pathOf(run.map(topAt)));

  const shades: [Array<string>, Array<string>, Array<string>, Array<string>] = [[], [], [], []];
  if (height > 0) {
    const [lx, ly] = [-sinA, cosA];
    normals.forEach(([nx, ny], index) => {
      if (!facing[index]) {
        return;
      }
      const shade = Math.min(3, Math.max(0, Math.floor(((nx * lx + ny * ly + 1) / 2) * 4)));
      const next = (index + 1) % count;
      shades[shade]?.push(
        pathOf(oriented([topAt(index), topAt(next), bottomAt(next), bottomAt(index)]), true),
      );
    });
  }

  const bevelPath =
    bevel > 0
      ? runsOf(facing, true)
          .map((run) => {
            const inset = (index: number): Flat => {
              const [x, y] = at(ring, index, [0, 0]);
              const [ax, ay] = at(normals, (index + count - 1) % count, [0, 0]);
              const [bx, by] = at(normals, index, [0, 0]);
              const length = Math.hypot(ax + bx, ay + by) || 1;
              return iso(
                [x - ((ax + bx) / length) * bevel, y - ((ay + by) / length) * bevel, z + height],
                projection,
              );
            };
            const firstIndex = run[0] ?? 0;
            const lastIndex = run[run.length - 1] ?? 0;
            return pathOf([topAt(firstIndex), ...run.slice(1, -1).map(inset), topAt(lastIndex)]);
          })
          .join('')
      : '';

  return {
    fill: pathOf(hullOf([...top, ...bottom]), true),
    shades: [shades[0].join(''), shades[1].join(''), shades[2].join(''), shades[3].join('')],
    top: pathOf(oriented(top), true),
    crease: crease.join(''),
    bevel: bevelPath,
    outline: outline.join(''),
  };
};

/** A rounded box: `plan` from `z` up by `height`. */
export const slabOf = (
  plan: Plan,
  z: number,
  height: number,
  projection: Projection,
  steps = 8,
  bevel = 0,
): SolidPaths => extrude(roundedPlan(plan, steps), z, height, projection, bevel);

/** A round post, puck, foot, or knob. */
export const cylinder = (
  cx: number,
  cy: number,
  radius: number,
  z: number,
  height: number,
  projection: Projection,
  steps = 32,
  bevel = 0,
): SolidPaths => extrude(circleRing(cx, cy, radius, steps), z, height, projection, bevel);

/** The direction toward the viewer, in the state. */
export const viewOf = (projection: Projection): Point3 => {
  const { sinA, cosA, sinE, cosE } = cameraOf(projection);
  return [cosA * cosE, sinA * cosE, sinE];
};

const dot = (a: Point3, b: Point3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const scaled = (a: Point3, by: number): Point3 => [a[0] * by, a[1] * by, a[2] * by];
const plus = (a: Point3, b: Point3): Point3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const unit = (a: Point3): Point3 => scaled(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));
const crossed = (a: Point3, b: Point3): Point3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Two directions square to `axis` and to each other. */
const squareTo = (axis: Point3): readonly [Point3, Point3] => {
  const first = unit(crossed(axis, Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
  return [first, crossed(axis, first)];
};

/** A cone cut level at `height`, standing on the floor at `z`: `radius` wide at its foot and `top` wide at its cut, which a cone without one closes to a tip. Its sides are shaded by facing, as a box's are. */
export const frustum = (
  cx: number,
  cy: number,
  radius: number,
  top: number,
  z: number,
  height: number,
  projection: Projection,
  steps = 36,
): SolidPaths => {
  const { sinA, cosA } = cameraOf(projection);
  const view = viewOf(projection);
  const foot = circleRing(cx, cy, radius, steps).map(([x, y]) => iso([x, y, z], projection));
  const cut = circleRing(cx, cy, top, steps).map(([x, y]) => iso([x, y, z + height], projection));
  const shades: [Array<string>, Array<string>, Array<string>, Array<string>] = [[], [], [], []];
  const [lx, ly] = [-sinA, cosA];
  foot.forEach((corner, index) => {
    const angle = ((index + 0.5) / steps) * Math.PI * 2;
    const normal: Point3 = [Math.cos(angle) * height, Math.sin(angle) * height, radius - top];
    if (dot(normal, view) <= 0) {
      return;
    }
    const lit = (Math.cos(angle) * lx + Math.sin(angle) * ly + 1) / 2;
    const shade = Math.min(3, Math.max(0, Math.floor(lit * 4)));
    const next = (index + 1) % steps;
    shades[shade]?.push(
      pathOf(
        oriented([corner, at(foot, next, corner), at(cut, next, corner), at(cut, index, corner)]),
        true,
      ),
    );
  });
  const hull = pathOf(hullOf([...foot, ...cut]), true);
  return {
    fill: hull,
    shades: [shades[0].join(''), shades[1].join(''), shades[2].join(''), shades[3].join('')],
    top: top > 0 ? pathOf(oriented(cut), true) : '',
    crease: '',
    bevel: '',
    outline: hull,
  };
};

/** A cone standing on the floor at `z`, `radius` wide at its foot and `height` tall. */
export const cone = (
  cx: number,
  cy: number,
  radius: number,
  z: number,
  height: number,
  projection: Projection,
  steps = 36,
): SolidPaths => frustum(cx, cy, radius, 0, z, height, projection, steps);

/** Where on a globe of `radius` round `centre` a thing stands at `longitude` and `latitude`, in degrees, and the way up from there. */
export const onGlobe = (
  centre: Point3,
  radius: number,
  longitude: number,
  latitude: number,
): { readonly at: Point3; readonly up: Point3 } => {
  const [lon, lat] = [longitude * RADIANS, latitude * RADIANS];
  const up: Point3 = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  return { at: plus(centre, scaled(up, radius)), up };
};

/** Whether a point of a globe whose way up is `up` faces the viewer. */
export const facesViewer = (up: Point3, projection: Projection, least = 0): boolean =>
  dot(up, viewOf(projection)) > least;

/** The way the light comes from: from above, on the side a box's lightest face turns to. */
const lightOf = (projection: Projection): Point3 => {
  const { sinA, cosA } = cameraOf(projection);
  return unit([-sinA, cosA, 1.3]);
};

/** A ball of `radius` round `centre`: its outline a circle, and its tones the bands of its face lit alike, from darkest at the edge away from the light to lightest where the light falls square. */
export const sphere = (
  centre: Point3,
  radius: number,
  projection: Projection,
  steps = 72,
): SolidPaths => {
  const view = viewOf(projection);
  const light = lightOf(projection);
  const [viewU, viewW] = squareTo(view);
  const [lightA, lightB] = squareTo(light);
  const project = (direction: Point3) => iso(plus(centre, scaled(direction, radius)), projection);
  const angles = Array.from({ length: steps }, (_, index) => (index / steps) * Math.PI * 2);
  const limb = angles.map((angle) =>
    plus(scaled(viewU, Math.cos(angle)), scaled(viewW, Math.sin(angle))),
  );
  const disc = pathOf(limb.map(project), true);
  // Where the light falls at least as square as `least`: the rim of that cap where it faces the viewer, and the edge of the ball within it.
  const band = (least: number) => {
    const across = Math.sqrt(Math.max(0, 1 - least * least));
    const rim = angles
      .map((angle) =>
        plus(
          scaled(light, least),
          plus(scaled(lightA, across * Math.cos(angle)), scaled(lightB, across * Math.sin(angle))),
        ),
      )
      .filter((direction) => dot(direction, view) >= 0);
    const edge = limb.filter((direction) => dot(direction, light) >= least);
    const points = [...rim, ...edge].map(project);
    return points.length < 3 ? '' : pathOf(hullOf(points), true);
  };
  return {
    fill: disc,
    shades: [disc, band(-0.15), band(0.3), band(0.65)],
    top: band(0.9),
    crease: '',
    bevel: '',
    outline: disc,
  };
};

/** A line drawn on a ball's face through the directions `along`, where it faces the viewer: a meridian or a parallel. */
export const onSphere = (
  centre: Point3,
  radius: number,
  along: ReadonlyArray<Point3>,
  projection: Projection,
): string => {
  const view = viewOf(projection);
  const runs: Array<Array<Flat>> = [[]];
  for (const direction of along) {
    if (dot(direction, view) > 0.02) {
      runs[runs.length - 1]?.push(iso(plus(centre, scaled(direction, radius)), projection));
    } else if ((runs[runs.length - 1]?.length ?? 0) > 0) {
      runs.push([]);
    }
  }
  return runs
    .filter((run) => run.length > 1)
    .map((run) => pathOf(run))
    .join('');
};

/** The directions round a meridian at `longitude`, from pole to pole. */
export const meridian = (longitude: number, steps = 48): ReadonlyArray<Point3> =>
  Array.from({ length: steps + 1 }, (_, index) => {
    const latitude = -Math.PI / 2 + (index / steps) * Math.PI;
    const lon = longitude * RADIANS;
    return [
      Math.cos(latitude) * Math.cos(lon),
      Math.cos(latitude) * Math.sin(lon),
      Math.sin(latitude),
    ];
  });

/** The directions round a parallel at `latitude`, all the way round. */
export const parallel = (latitude: number, steps = 72): ReadonlyArray<Point3> =>
  Array.from({ length: steps + 1 }, (_, index) => {
    const longitude = (index / steps) * Math.PI * 2;
    const lat = latitude * RADIANS;
    return [
      Math.cos(lat) * Math.cos(longitude),
      Math.cos(lat) * Math.sin(longitude),
      Math.sin(lat),
    ];
  });

/** `plan` shrunk by `by` on every side. */
export const insetPlan = ({ x, y, w, d, r }: Plan, by: number): Plan => ({
  x: x + by,
  y: y + by,
  w: w - by * 2,
  d: d - by * 2,
  r: Math.max(0, r - by),
});

/** A line through `points` on a level face at height `z`. */
export const onTop = (
  points: ReadonlyArray<Plane>,
  z: number,
  projection: Projection,
  isClosed = false,
): string =>
  pathOf(
    points.map(([x, y]) => iso([x, y, z], projection)),
    isClosed,
  );

/** The outline of `plan` drawn on a level face at height `z`: a groove or an inlay. */
export const planOutline = (plan: Plan, z: number, projection: Projection, steps = 8): string =>
  onTop(roundedPlan(plan, steps), z, projection, true);

/** One segment on a level face. */
export const lineOnTop = (from: Plane, to: Plane, z: number, projection: Projection): string =>
  onTop([from, to], z, projection);

/** A straight line between two points of the state. */
export const segment = (from: Point3, to: Point3, projection: Projection): string =>
  pathOf([iso(from, projection), iso(to, projection)]);

/** A circle on a level face: a screw's ring, a socket, a bezel. */
export const ring = (
  cx: number,
  cy: number,
  radius: number,
  z: number,
  projection: Projection,
  steps = 40,
): string => onTop(circleRing(cx, cy, radius, steps), z, projection, true);

/** Four floor points inset from the corners of `plan`, for feet and screws. */
export const corners = ({ x, y, w, d }: Plan, inset = 0): ReadonlyArray<Plane> => [
  [x + inset, y + inset],
  [x + w - inset, y + inset],
  [x + inset, y + d - inset],
  [x + w - inset, y + d - inset],
];

/** The eight corners of `plan` between two heights, to fit a camera to. */
export const boxCorners = ({ x, y, w, d }: Plan, z0: number, z1: number): ReadonlyArray<Point3> =>
  [x, x + w].flatMap((px) => [y, y + d].flatMap((py) => [z0, z1].map((z): Point3 => [px, py, z])));

/** Upright lines round the side of a cylinder that faces the viewer: a knob's knurl. */
export const knurl = (
  cx: number,
  cy: number,
  radius: number,
  z0: number,
  z1: number,
  count: number,
  projection: Projection,
  inset = 0.4,
): string => {
  const [vx, vy] = towardViewer(projection);
  return Array.from({ length: count }, (_, index) => (index / count) * Math.PI * 2)
    .filter((angle) => Math.cos(angle) * vx + Math.sin(angle) * vy >= 0.15)
    .map((angle) => {
      const [x, y] = [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
      return pathOf([iso([x, y, z0 + inset], projection), iso([x, y, z1 - inset], projection)]);
    })
    .join('');
};

/** The half of a level circle on a cylinder's side that faces the viewer: a seam or a band. */
export const sideArc = (
  cx: number,
  cy: number,
  radius: number,
  z: number,
  projection: Projection,
  steps = 24,
): string => {
  const [vx, vy] = towardViewer(projection);
  const facing = Math.atan2(vy, vx);
  return pathOf(
    Array.from({ length: steps + 1 }, (_, step) => {
      const angle = facing - Math.PI / 2 + (step / steps) * Math.PI;
      return iso([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle), z], projection);
    }),
  );
};

/** The same for a box: the near half of `plan` at height `z`, round its corners, ending on the box's upright edges. */
export const sideSeam = (plan: Plan, z: number, projection: Projection, steps = 8): string => {
  const outline = roundedPlan(plan, steps);
  const count = outline.length;
  const isCounter = signedArea(outline) > 0;
  const [vx, vy] = towardViewer(projection);
  const facing = outline.map(([ax, ay], index) => {
    const [bx, by] = at(outline, (index + 1) % count, [ax, ay]);
    const [nx, ny] = isCounter ? [by - ay, ax - bx] : [ay - by, bx - ax];
    return nx * vx + ny * vy > 1e-9;
  });
  return runsOf(facing, true)
    .map((run) =>
      pathOf(
        run.map((index) => {
          const [x, y] = at(outline, index, [0, 0]);
          return iso([x, y, z], projection);
        }),
      ),
    )
    .join('');
};

/** Ruler ticks on a level face, every `step` along `x` from `edge` toward `+y`, every `every`th one long. */
export const topTicks = (
  from: number,
  to: number,
  step: number,
  every: number,
  edge: number,
  z: number,
  lengths: readonly [number, number],
  projection: Projection,
): { readonly minor: string; readonly major: string } => {
  const first = Math.ceil(from / step);
  const count = Math.floor(to / step) - first + 1;
  const ticks = Array.from({ length: Math.max(0, count) }, (_, index) => first + index);
  const draw = (isMajor: boolean) =>
    ticks
      .filter((index) => (index % every === 0) === isMajor)
      .map((index) =>
        lineOnTop(
          [index * step, edge],
          [index * step, edge + (isMajor ? lengths[1] : lengths[0])],
          z,
          projection,
        ),
      )
      .join('');
  return { minor: draw(false), major: draw(true) };
};

/** Ticks round a dial face, from 0 at `-y` clockwise as seen from above, every `every`th one long. */
export const radialTicks = (
  cx: number,
  cy: number,
  radius: number,
  count: number,
  every: number,
  z: number,
  lengths: readonly [number, number],
  projection: Projection,
): { readonly minor: string; readonly major: string } => {
  const draw = (isMajor: boolean) =>
    Array.from({ length: count }, (_, index) => index)
      .filter((index) => (index % every === 0) === isMajor)
      .map((index) => {
        const angle = (index / count) * Math.PI * 2;
        const [sx, sy] = [Math.sin(angle), -Math.cos(angle)];
        const inner = radius - (isMajor ? lengths[1] : lengths[0]);
        return lineOnTop(
          [cx + sx * inner, cy + sy * inner],
          [cx + sx * radius, cy + sy * radius],
          z,
          projection,
        );
      })
      .join('');
  return { minor: draw(false), major: draw(true) };
};

const fine = (value: number) => Math.round(value * 100) / 100;

/** The SVG transform that moves something drawn at rest by the state offset `by`. */
export const translateAlong = (projection: Projection, by: Point3): string => {
  const [ox, oy] = iso([0, 0, 0], projection);
  const [mx, my] = iso(by, projection);
  return `translate(${fine(mx - ox)} ${fine(my - oy)})`;
};

/** The SVG transform that lays flat drawing onto the upright face at `y = at[1]` facing `+y`, its origin at `at` and height `z`: right is `+x` and down is `-z`. */
export const frontFace = (at: Plane, z: number, projection: Projection): string => {
  const origin = iso([at[0], at[1], z], projection);
  const along = (point: Point3): Flat => {
    const [px, py] = iso(point, projection);
    return [px - origin[0], py - origin[1]];
  };
  const right = along([at[0] + 1, at[1], z]);
  const up = along([at[0], at[1], z + 1]);
  const third = (value: number) => Math.round(value * 1000) / 1000;
  return `matrix(${[right[0], right[1], -up[0], -up[1], origin[0], origin[1]].map(third).join(' ')})`;
};

/** A camera that fits `points` in a `width` by `height` page with `pad` round them. */
export const fitProjection = (
  points: ReadonlyArray<Point3>,
  width: number,
  height: number,
  {
    pad,
    azimuth,
    elevation,
  }: { readonly pad: number; readonly azimuth: number; readonly elevation: number },
): Projection => {
  const unit: Projection = { origin: [0, 0], scale: 1, azimuth, elevation };
  const flats = points.map((point) => iso(point, unit));
  const xs = flats.map(([x]) => x);
  const ys = flats.map(([, y]) => y);
  const [left, right, up, down] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
  ];
  const scale = Math.min((width - pad * 2) / (right - left), (height - pad * 2) / (down - up));
  return {
    origin: [width / 2 - ((left + right) / 2) * scale, height / 2 - ((up + down) / 2) * scale],
    scale,
    azimuth,
    elevation,
  };
};
