import { Styled } from '@lightocean/foldkit';
import * as stylex from '@stylexjs/stylex';
import { Match, Option } from 'effect';
import type { Html, HtmlBuilder } from 'foldkit/html';
import { createKeyedLazy, createLazy } from 'foldkit/html';
import { defineView } from 'foldkit/submodel';
import { Iso } from '#src/figure/index.ts';
import {
  Message,
  type Model,
  SHOWN,
  type Stamp,
  poseOf,
  pressedOf,
  readoutOf,
} from '#src/statePress.ts';
// Relative, as StyleX finds variables by the path of the module that defines them.
import { colours, inks } from './tokens.stylex.ts';

/**
 * How the state press is drawn: a bench on feet with a ruler and a label plate, two rails with five plates on them, and a press at their end with a tick counter on its head and a random dial on its arm. Each plate holds a state: three rows of sockets, a round peg for a position, a tree for a model, and a capped peg for health, each peg as tall as its value. Everything is drawn back to front, and only what moves is drawn again while it moves.
 */

const WIDTH = 600;
const HEIGHT = 380;

const PLATE: Iso.Plan = { x: -214, y: -66, w: 344, d: 132, r: 8 };
const PLATE_H = 12;
const FOOT_H = 5;
const PITCH = 56;
const SLOTS: ReadonlyArray<number> = [-168, -112, -56, 0, 56];
const PRESS_X = 56;
const RAIL_TOP = 3;
const TRAY: Iso.Plan = { x: -23, y: -29, w: 46, d: 58, r: 3 };
const TRAY_TOP = RAIL_TOP + 5;

const COLUMN: Iso.Plane = [PRESS_X, -52];
const COLUMN_R = 7;
const ARM_Z = 106;
const ARM_H = 10;
const ARM: Iso.Plan = { x: PRESS_X - 10, y: -60, w: 20, d: 66, r: 3 };
const HEAD: Iso.Plan = { x: PRESS_X - 16, y: -13, w: 32, d: 28, r: 3 };
const HEAD_Z = 74;
const PAD_REST = 60;
const PAD_DOWN = 48;
const DIAL: Iso.Plane = [PRESS_X, -16];
const DIAL_R = 8.4;
const DIAL_Z = ARM_Z + ARM_H;
const DIAL_TOP = DIAL_Z + 4;

const P = Iso.fitProjection(
  [
    ...Iso.boxCorners(PLATE, -PLATE_H - FOOT_H, 0),
    [COLUMN[0], COLUMN[1], ARM_Z + ARM_H + 16],
    [DIAL[0], DIAL[1], DIAL_TOP + 2],
    [HEAD.x + HEAD.w, HEAD.y + HEAD.d, ARM_Z],
  ],
  WIDTH,
  HEIGHT,
  { pad: 26, azimuth: 60, elevation: 30 },
);

const LINE = 0.6;

const styles = stylex.create({
  figure: { marginInline: 0, marginTop: 8, marginBottom: 32 },
  card: {
    position: 'relative',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colours.border,
    borderRadius: 10,
    backgroundColor: inks.card,
    outline: { default: 'none', ':focus-visible': `2px solid ${colours.accent}` },
    outlineOffset: 2,
    cursor: 'pointer',
    userSelect: 'none',
  },
  corners: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 16,
    paddingInline: 16,
    color: colours.muted,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 12,
    letterSpacing: '0.04em',
  },
  upper: { paddingTop: 12 },
  lower: { paddingBottom: 12, flexWrap: 'wrap' },
  title: { textTransform: 'uppercase' },
  hint: { textTransform: 'uppercase' },
  readout: { color: colours.text },
  svg: { display: 'block', width: '100%', height: 'auto', overflow: 'visible' },
  caption: { marginTop: 12, color: colours.muted, fontSize: 15 },

  fill: { fill: inks.paper, stroke: 'none' },
  litFill: { fill: inks.litFace },
  shade0: { fill: inks.shade0, stroke: 'none' },
  shade1: { fill: inks.shade1, stroke: 'none' },
  shade2: { fill: inks.shade2, stroke: 'none' },
  shade3: { fill: inks.shade3, stroke: 'none' },
  litShade: { fill: inks.litShade },
  top: { fill: inks.top, stroke: 'none' },
  litTop: { fill: inks.litTop },
  line: {
    fill: 'none',
    strokeWidth: LINE,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    vectorEffect: 'non-scaling-stroke',
  },
  hi: { stroke: inks.hi },
  mid: { stroke: inks.mid },
  lo: { stroke: inks.lo },
  faint: { stroke: inks.faint },
  lit: { stroke: inks.lit },
  needle: { strokeWidth: 0.9 },
  dot: { fill: inks.dot, stroke: 'none' },
  dotHi: { opacity: 0.85 },
  dotMid: { opacity: 0.45 },
  dotLo: { opacity: 0.22 },
  halo: { fill: inks.halo, stroke: 'none', filter: 'blur(9px)', opacity: 0.9 },
  softHalo: { filter: 'blur(3px)' },
  window: { fill: inks.shade0, stroke: inks.lo, strokeWidth: LINE },
  digit: {
    fill: inks.hi,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 7.2,
    fontWeight: 600,
  },
  plate: { cursor: 'pointer' },
});

type Tone = 'hi' | 'mid' | 'lo' | 'faint' | 'lit';

const toneStyle = (tone: Tone) => styles[tone];

/** What a solid is drawn as: its tone, the tone of its crease, whether it is the lit part, and seams drawn under its outline. */
interface SolidStyle {
  readonly tone?: Tone;
  readonly crease?: Tone | 'None';
  readonly isLit?: boolean;
  readonly inner?: string;
}

/** The pieces the figure is drawn of, built with `h`. */
const draw = (h: HtmlBuilder<Message>) => {
  const path = (d: string, ...style: ReadonlyArray<Styled.Style>): ReadonlyArray<Html> =>
    d === '' ? [] : [h.path([h.D(d), ...Styled.attributes(h, ...style)])];

  const line = (d: string, tone: Tone = 'lo'): ReadonlyArray<Html> =>
    path(d, styles.line, toneStyle(tone));

  const solid = (
    paths: Iso.SolidPaths,
    { tone = 'hi', crease = 'faint', isLit = false, inner = '' }: SolidStyle = {},
  ): Html =>
    h.g(
      [],
      [
        ...path(paths.fill, styles.fill, isLit && styles.litFill),
        ...path(paths.shades[0], styles.shade0, isLit && styles.litShade),
        ...path(paths.shades[1], styles.shade1, isLit && styles.litShade),
        ...path(paths.shades[2], styles.shade2, isLit && styles.litShade),
        ...path(paths.shades[3], styles.shade3, isLit && styles.litShade),
        ...path(paths.top, styles.top, isLit && styles.litTop),
        ...(crease === 'None' ? [] : [...line(paths.crease, crease), ...line(paths.bevel, crease)]),
        ...line(inner, 'faint'),
        ...path(paths.outline, styles.line, isLit ? styles.lit : toneStyle(tone)),
      ],
    );

  const dots = (
    points: ReadonlyArray<Iso.Flat>,
    size: number,
    tone: 'hi' | 'mid' | 'lo' = 'mid',
  ): Html =>
    h.g(
      Styled.attributes(
        h,
        styles.dot,
        tone === 'hi' ? styles.dotHi : tone === 'mid' ? styles.dotMid : styles.dotLo,
      ),
      points.map(([x, y]) => h.circle([h.Cx(String(x)), h.Cy(String(y)), h.R(String(size))])),
    );

  const halo = (d: string, isSoft = false): Html =>
    h.path([h.D(d), ...Styled.attributes(h, styles.halo, isSoft && styles.softHalo)]);

  const at = (point: Iso.Point3) => Iso.iso(point, P);

  const byDepth = (points: ReadonlyArray<Iso.Plane>) =>
    [...points].sort((a, b) => Iso.depthOf([a[0], a[1], 0], P) - Iso.depthOf([b[0], b[1], 0], P));

  return { path, line, solid, dots, halo, at, byDepth };
};

type Draw = ReturnType<typeof draw>;

// THE BENCH

const bench = ({ line, solid, dots, halo, at, byDepth }: Draw): ReadonlyArray<Html> => {
  const screws = Iso.corners(PLATE, 10);
  const strip: Iso.Plan = { x: SLOTS[0] ?? 0, y: 40, w: 0, d: 8, r: 1 };
  const ruler: Iso.Plan = { ...strip, x: strip.x - 30, w: PRESS_X - strip.x + 60 };
  const ticks = Iso.topTicks(
    ruler.x + 4,
    ruler.x + ruler.w - 4,
    4,
    7,
    ruler.y + 0.8,
    0.6,
    [2, 3.6],
    P,
  );
  const label: Iso.Plan = { x: PRESS_X + 22, y: 30, w: 40, d: 20, r: 1.5 };
  const rule = (y: number, length: number) =>
    Iso.lineOnTop([label.x + 5, label.y + y], [label.x + 5 + length, label.y + y], 0.8, P);
  return [
    halo(Iso.slabOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P).fill),
    ...byDepth(Iso.corners(PLATE, 22)).flatMap(([x, y]) => [
      solid(Iso.cylinder(x, y, 7, -PLATE_H - FOOT_H, 1.6, P, 28), { tone: 'lo' }),
      solid(Iso.cylinder(x, y, 5.4, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: 'mid' }),
    ]),
    solid(Iso.slabOf(PLATE, -PLATE_H, PLATE_H, P, 8, 1.6), {
      tone: 'mid',
      inner: Iso.sideSeam(PLATE, -5, P, 8),
    }),
    ...line(Iso.planOutline(Iso.insetPlan(PLATE, 5), 0, P)),
    ...line(screws.map(([x, y]) => Iso.ring(x, y, 2.2, 0, P, 16)).join('')),
    dots(
      screws.map(([x, y]) => at([x, y, 0])),
      0.5,
    ),
    solid(Iso.slabOf(ruler, 0, 0.6, P, 3), { tone: 'lo', crease: 'None' }),
    ...line(ticks.minor),
    ...line(
      SLOTS.map((x) => Iso.lineOnTop([x, ruler.y + 0.8], [x, ruler.y + 5.6], 0.6, P)).join(''),
      'mid',
    ),
    dots(
      [at([ruler.x + 2, ruler.y + 4, 0.6]), at([ruler.x + ruler.w - 2, ruler.y + 4, 0.6])],
      0.45,
    ),
    solid(Iso.slabOf(label, 0, 0.8, P, 4), { tone: 'lo', crease: 'None' }),
    ...line(Iso.planOutline(Iso.insetPlan(label, 1.6), 0.8, P, 3), 'faint'),
    ...line(rule(6, 25) + rule(10, 19) + rule(14, 28)),
    dots(
      [
        at([label.x + 2.6, label.y + 2.6, 0.8]),
        at([label.x + label.w - 2.6, label.y + label.d - 2.6, 0.8]),
      ],
      0.42,
    ),
  ];
};

const rails = ({ solid, dots, at }: Draw): ReadonlyArray<Html> => {
  const from = (SLOTS[0] ?? 0) - 34;
  const to = PRESS_X + 32;
  return [
    ...[-22, 15].flatMap((y) => [
      solid(Iso.slabOf({ x: from, y, w: to - from, d: 7, r: 1 }, 0, RAIL_TOP, P, 3, 0.4), {
        tone: 'mid',
      }),
      dots(
        [from + 5, ...SLOTS.slice(0, 4).map((x) => x + PITCH / 2), to - 5].map((x) =>
          at([x, y + 3.5, RAIL_TOP]),
        ),
        0.4,
        'lo',
      ),
    ]),
    ...[from - 6, to].flatMap((x) => [
      solid(Iso.slabOf({ x, y: -26, w: 6, d: 45, r: 1.2 }, 0, 9, P, 3, 0.5), { tone: 'mid' }),
      dots([at([x + 3, -21, 9]), at([x + 3, 14, 9])], 0.45),
    ]),
  ];
};

// THE PRESS

const columnBelowArm = ({ solid, dots, at }: Draw): ReadonlyArray<Html> => {
  const [cx, cy] = COLUMN;
  const foot: Iso.Plan = { x: cx - 18, y: cy - 12, w: 36, d: 22, r: 3 };
  return [
    solid(Iso.slabOf(foot, 0, 6, P, 4, 0.6), { tone: 'mid' }),
    dots(
      Iso.corners(foot, 3.6).map(([x, y]) => at([x, y, 6])),
      0.5,
    ),
    solid(Iso.cylinder(cx, cy, 10, 6, 4, P, 36, 0.5), { tone: 'mid' }),
    solid(Iso.cylinder(cx, cy, COLUMN_R, 10, ARM_Z - 10, P, 36), {
      tone: 'mid',
      crease: 'None',
      inner: [40, 70].map((z) => Iso.sideArc(cx, cy, COLUMN_R, z, P, 20)).join(''),
    }),
  ];
};

/** The plunger at rest: its rod, rising into the head, and the pad that comes down on a new plate. */
const plunger = ({ solid, line }: Draw): ReadonlyArray<Html> => [
  solid(Iso.cylinder(PRESS_X, 0, 2.4, PAD_REST + 3, HEAD_Z + 8 - PAD_REST - 3, P, 20), {
    tone: 'mid',
    crease: 'None',
  }),
  solid(Iso.cylinder(PRESS_X, 0, 10, PAD_REST, 3, P, 40, 0.5), { tone: 'mid', crease: 'lo' }),
  ...line(Iso.ring(PRESS_X, 0, 6, PAD_REST, P, 24), 'faint'),
];

const FACE = HEAD.y + HEAD.d;
const COUNTER: Iso.Plan = { x: PRESS_X - 13, y: FACE, w: 26, d: 2, r: 0.6 };
const CELLS: ReadonlyArray<number> = [0, 1, 2, 3].map((index) => 2.2 + index * 5.5);

const head = ({ solid, dots, at, path }: Draw, h: HtmlBuilder<Message>): ReadonlyArray<Html> => [
  solid(Iso.cylinder(PRESS_X, 0, 4.6, HEAD_Z - 4, 4, P, 24, 0.3), { tone: 'mid' }),
  solid(Iso.slabOf(HEAD, HEAD_Z, ARM_Z - HEAD_Z, P, 4, 0.6), {
    tone: 'mid',
    inner: Iso.sideSeam(HEAD, HEAD_Z + 6, P, 4),
  }),
  solid(Iso.slabOf(COUNTER, HEAD_Z + 11, 18, P, 2, 0.3), { tone: 'mid' }),
  h.g(
    [h.Transform(Iso.frontFace([COUNTER.x, FACE + 2], HEAD_Z + 29, P))],
    [
      h.rect([
        h.X('1.6'),
        h.Y('4.4'),
        h.Width('22.8'),
        h.Height('10'),
        h.Rx('1'),
        ...Styled.attributes(h, styles.window),
      ]),
      ...path(
        CELLS.slice(1)
          .map((u) => `M${u - 0.25} 4.4V14.4`)
          .join(''),
        styles.line,
        styles.lo,
      ),
    ],
  ),
  dots(
    [
      at([COUNTER.x + 2, FACE + 2, HEAD_Z + 27]),
      at([COUNTER.x + COUNTER.w - 2, FACE + 2, HEAD_Z + 27]),
      at([COUNTER.x + 2, FACE + 2, HEAD_Z + 13]),
      at([COUNTER.x + COUNTER.w - 2, FACE + 2, HEAD_Z + 13]),
    ],
    0.42,
  ),
  solid(Iso.slabOf({ x: HEAD.x + HEAD.w, y: -3, w: 3, d: 6, r: 0.8 }, HEAD_Z + 14, 6, P, 2), {
    tone: 'mid',
    crease: 'None',
  }),
];

/** The tick counter's digits, on the head's front face. */
const counter = (h: HtmlBuilder<Message>, tick: number): Html => {
  const digits = String(tick % 10000).padStart(4, '0');
  return h.g(
    [h.Transform(Iso.frontFace([COUNTER.x, FACE + 2], HEAD_Z + 29, P))],
    CELLS.map((u, index) =>
      h.text(
        [
          h.X(String(u + 2.5)),
          h.Y('12.2'),
          h.TextAnchor('middle'),
          ...Styled.attributes(h, styles.digit),
        ],
        [digits[index] ?? '0'],
      ),
    ),
  );
};

const arm = ({ solid, line, dots, at }: Draw): ReadonlyArray<Html> => {
  const [cx, cy] = COLUMN;
  const lever: Iso.Plane = [ARM.x + ARM.w + 6, -44];
  const [x, y] = DIAL;
  const ticks = Iso.radialTicks(x, y, DIAL_R - 1.8, 32, 4, DIAL_TOP, [0.9, 1.9], P);
  return [
    solid(Iso.slabOf(ARM, ARM_Z, ARM_H, P, 4, 0.6), {
      tone: 'mid',
      inner: Iso.sideSeam(ARM, ARM_Z + 3, P, 4),
    }),
    dots(
      [
        at([ARM.x + 4, ARM.y + ARM.d - 4, ARM_Z + ARM_H]),
        at([ARM.x + ARM.w - 4, ARM.y + ARM.d - 4, ARM_Z + ARM_H]),
        at([ARM.x + 4, -32, ARM_Z + ARM_H]),
        at([ARM.x + ARM.w - 4, -32, ARM_Z + ARM_H]),
      ],
      0.45,
    ),
    solid(Iso.cylinder(cx, cy, COLUMN_R, ARM_Z + ARM_H, 10, P, 36), {
      tone: 'mid',
      crease: 'None',
    }),
    solid(Iso.cylinder(cx, cy, 8.2, ARM_Z + ARM_H + 10, 3, P, 36, 0.5), { tone: 'mid' }),
    ...line(Iso.ring(cx, cy, 3, ARM_Z + ARM_H + 13, P, 20)),
    solid(Iso.slabOf({ x: ARM.x + ARM.w, y: -46, w: 3, d: 4, r: 0.8 }, ARM_Z + 2, 5, P, 2), {
      tone: 'mid',
      crease: 'None',
    }),
    solid(Iso.cylinder(lever[0], lever[1], 3, ARM_Z + 1, 7, P, 20), { tone: 'mid' }),
    ...line(Iso.knurl(lever[0], lever[1], 3, ARM_Z + 1, ARM_Z + 8, 18, P)),
    solid(Iso.cylinder(x, y, DIAL_R, DIAL_Z, 4, P, 48, 0.6), { tone: 'hi', crease: 'lo' }),
    ...line(Iso.knurl(x, y, DIAL_R, DIAL_Z + 1.2, DIAL_TOP, 54, P, 0.3)),
    ...line(Iso.ring(x, y, DIAL_R - 1.4, DIAL_TOP, P, 48)),
    ...line(ticks.minor),
    ...line(ticks.major, 'mid'),
    ...line(Iso.ring(x, y, 1, DIAL_TOP, P, 12), 'mid'),
  ];
};

/** The random dial's needle, at the share of a turn the random counter is of its range. */
const needle = ({ path }: Draw, random: number): ReadonlyArray<Html> => {
  const angle = (random / 2 ** 32) * Math.PI * 2;
  const [x, y] = DIAL;
  return path(
    Iso.lineOnTop(
      [x - Math.sin(angle) * 1.8, y + Math.cos(angle) * 1.8],
      [x + Math.sin(angle) * 6.2, y - Math.cos(angle) * 6.2],
      DIAL_TOP + 0.2,
      P,
    ),
    styles.line,
    styles.lit,
    styles.needle,
  );
};

// A STATE

/** How large a state's globe is, and how high its middle stands above the bench. */
const GLOBE_R = 15;
const STAND_H = 4;
const GLOBE: Iso.Point3 = [0, 0, TRAY_TOP + STAND_H + GLOBE_R];

/** How high a dragon flies above the globe. */
const FLIGHT = 5;

/** The way east along the globe at `longitude`, and the way out from its axis. */
const headingOf = (longitude: number) => {
  const lon = (longitude * Math.PI) / 180;
  return {
    ahead: [-Math.sin(lon), Math.cos(lon), 0] as const,
    out: [Math.cos(lon), Math.sin(lon), 0] as const,
  };
};

const along = (from: Iso.Point3, by: Iso.Point3, length: number): Iso.Point3 => [
  from[0] + by[0] * length,
  from[1] + by[1] * length,
  from[2] + by[2] * length,
];

/** A tree: a trunk and three tiers of branches, each resting on the one below. */
const tree = ({ solid }: Draw, [x, y, z]: Iso.Point3, tone: Tone): ReadonlyArray<Html> => [
  solid(Iso.cylinder(x, y, 0.5, z - 0.4, 2, P, 12), { tone, crease: 'None' }),
  ...(
    [
      [1.4, 2.3, 3],
      [3, 1.8, 2.7],
      [4.5, 1.3, 2.4],
    ] as const
  ).map(([up, r, height]) =>
    solid(Iso.cone(x, y, r, z + up, height, P, 24), { tone, crease: 'None' }),
  ),
];

/** A volcano: a cut cone with its crater open at the top, and a puff of smoke over it. */
const volcano = ({ solid, line }: Draw, [x, y, z]: Iso.Point3, tone: Tone): ReadonlyArray<Html> => [
  solid(Iso.frustum(x, y, 4.4, 1.6, z - 1, 4.4, P, 32), { tone, crease: 'None' }),
  ...line(Iso.ring(x, y, 1, z + 3.4, P, 16)),
  solid(Iso.sphere([x - 0.4, y + 0.3, z + 5.2], 0.9, P, 24), { tone: 'mid' }),
  solid(Iso.sphere([x + 0.5, y - 0.2, z + 6.6], 0.7, P, 24), { tone: 'mid' }),
];

/** A warrior: legs, a tunic, a head, and a spear held upright beside her. */
const warrior = (
  { solid, line }: Draw,
  [x, y, z]: Iso.Point3,
  longitude: number,
  tone: Tone,
): ReadonlyArray<Html> => {
  const { ahead } = headingOf(longitude);
  const hand = along([x, y, z], [ahead[0], ahead[1], 0], 1.3);
  return [
    ...[-0.45, 0.45].map((by) => {
      const [lx, ly] = along([x, y, z], [ahead[0], ahead[1], 0], by);
      return solid(Iso.cylinder(lx, ly, 0.32, z - 0.3, 2, P, 10), { tone, crease: 'None' });
    }),
    solid(Iso.frustum(x, y, 1.1, 0.6, z + 1.4, 2.2, P, 20), { tone, crease: 'None' }),
    solid(Iso.sphere([x, y, z + 4.3], 0.75, P, 24), { tone }),
    ...line(Iso.segment([hand[0], hand[1], z + 0.6], [hand[0], hand[1], z + 6.4], P), 'hi'),
    solid(Iso.cone(hand[0], hand[1], 0.35, z + 6.4, 1, P, 12), { tone: 'hi', crease: 'None' }),
  ];
};

/** A dragon in flight above the globe: a body, a head ahead of it, a tail behind, and two wings spread across its way. */
const dragon = (
  draw: Draw,
  ground: Iso.Point3,
  longitude: number,
  tone: Tone,
): ReadonlyArray<Html> => {
  const { solid, line, dots, at } = draw;
  const { ahead, out } = headingOf(longitude);
  const body: Iso.Point3 = [ground[0], ground[1], ground[2] + FLIGHT];
  const head = along(along(body, [ahead[0], ahead[1], 0], 2.4), [0, 0, 1], 0.8);
  const wing = (side: number) => {
    const tip = along(along(body, [out[0], out[1], 0], 5.5 * side), [ahead[0], ahead[1], 0], -0.8);
    const fore = along(body, [ahead[0], ahead[1], 0], 1.1);
    const aft = along(body, [ahead[0], ahead[1], 0], -1.4);
    return {
      depth: Iso.depthOf(tip, P),
      art: solid(
        Iso.extrude(
          [
            [fore[0], fore[1]],
            [tip[0], tip[1]],
            [aft[0], aft[1]],
          ],
          body[2] + 0.4,
          0.3,
          P,
        ),
        { tone, crease: 'None' },
      ),
    };
  };
  const [far, near] = [wing(1), wing(-1)].sort((a, b) => a.depth - b.depth);
  const tail = along(along(body, [ahead[0], ahead[1], 0], -4.6), [0, 0, 1], -1);
  return [
    dots([at(ground)], 0.6, 'lo'),
    ...(far === undefined ? [] : [far.art]),
    ...line(
      Iso.segment(along(body, [ahead[0], ahead[1], 0], -1.2), tail, P),
      tone === 'hi' ? 'hi' : 'mid',
    ),
    solid(Iso.sphere(body, 1.5, P, 32), { tone }),
    solid(Iso.sphere(head, 0.9, P, 24), { tone }),
    ...(near === undefined ? [] : [near.art]),
  ];
};

/** A state on its carriage, drawn at rest at the origin: its globe on a stand, and every thing on the globe's side that faces the viewer. Bright when it is the state just made; its things appear once `grown` is half way, as it is stamped. */
const plate = (draw: Draw, state: Stamp, isNow: boolean, grown: number): ReadonlyArray<Html> => {
  const { solid, line, dots, halo, at } = draw;
  const tone: Tone = isNow ? 'hi' : 'mid';
  const graticule = [
    ...[0, 45, 90, 135, 180, 225, 270, 315].map((longitude) =>
      Iso.onSphere(GLOBE, GLOBE_R, Iso.meridian(longitude), P),
    ),
    ...[-30, 30, 60].map((latitude) => Iso.onSphere(GLOBE, GLOBE_R, Iso.parallel(latitude), P)),
  ].join('');
  const things = (grown > 0.5 ? state.things : [])
    .map((thing) => ({ thing, ...Iso.onGlobe(GLOBE, GLOBE_R, thing.longitude, thing.latitude) }))
    .filter(({ thing, up }) => Iso.facesViewer(up, P, thing.kind === 'Dragon' ? -0.1 : 0.08))
    .sort((a, b) => Iso.depthOf(a.at, P) - Iso.depthOf(b.at, P))
    .flatMap(({ thing, at: ground }) =>
      Match.value(thing.kind).pipe(
        Match.when('Tree', () => tree(draw, ground, tone)),
        Match.when('Volcano', () => volcano(draw, ground, tone)),
        Match.when('Warrior', () => warrior(draw, ground, thing.longitude, tone)),
        Match.when('Dragon', () => dragon(draw, ground, thing.longitude, tone)),
        Match.exhaustive,
      ),
    );
  return [
    halo(Iso.slabOf(Iso.insetPlan(TRAY, 2), RAIL_TOP, 0.1, P).fill, true),
    ...[-21, 14].map((y) =>
      solid(
        Iso.slabOf(
          { x: TRAY.x + 4, y: y - 0.5, w: TRAY.w - 8, d: 6, r: 1 },
          RAIL_TOP - 0.2,
          1,
          P,
          2,
        ),
        {
          tone: 'mid',
          crease: 'None',
        },
      ),
    ),
    solid(Iso.slabOf(TRAY, RAIL_TOP, TRAY_TOP - RAIL_TOP, P, 4, 0.6), {
      tone,
      crease: 'lo',
      isLit: isNow,
    }),
    ...line(Iso.planOutline(Iso.insetPlan(TRAY, 2.6), TRAY_TOP, P, 3), 'faint'),
    dots(
      Iso.corners(TRAY, 4.2).map(([x, y]) => at([x, y, TRAY_TOP])),
      0.42,
    ),
    solid(
      Iso.slabOf(
        { x: -6, y: TRAY.y + TRAY.d - 0.4, w: 12, d: 3.4, r: 1.2 },
        RAIL_TOP + 0.6,
        2.4,
        P,
        3,
      ),
      {
        tone: 'mid',
      },
    ),
    // The stand the globe rests on: a foot on the carriage and a post up to the globe's underside.
    solid(Iso.cylinder(0, 0, 6, TRAY_TOP, 1.4, P, 32, 0.4), { tone: 'mid' }),
    ...line(Iso.ring(0, 0, 4.4, TRAY_TOP + 1.4, P, 24), 'faint'),
    solid(Iso.cylinder(0, 0, 1.6, TRAY_TOP + 1.4, STAND_H - 1.4 + 1, P, 16), {
      tone: 'mid',
      crease: 'None',
    }),
    solid(Iso.sphere(GLOBE, GLOBE_R, P), { tone, isLit: isNow, inner: graticule }),
    ...things,
  ];
};

// THE FIGURE

// What never moves is built once: the bench and the rails behind the plates, and the press in front of them.
const staticBack = createLazy();
const staticPress = createLazy();
// A plate is built again only when what it shows changes, as the one being stamped does while its pegs rise. Plates are kept by their tick round a ring of slots, more than the rail ever holds at once, so the cache stays as small as the rail.
const plateCache = createKeyedLazy();
const PLATE_SLOTS = SHOWN + 3;
const plateOf = (h: HtmlBuilder<Message>, state: Stamp, isNow: boolean, grown: number): Html =>
  h.g([], plate(draw(h), state, isNow, grown));
const backOf = (h: HtmlBuilder<Message>): Html => {
  const parts = draw(h);
  return h.g([], [...bench(parts), ...rails(parts), ...columnBelowArm(parts)]);
};
const pressOf = (h: HtmlBuilder<Message>): Html => {
  const parts = draw(h);
  return h.g([], [...head(parts, h), ...arm(parts)]);
};

const keyOf = (
  key: string,
  modifiers: { readonly shiftKey: boolean },
  model: Model,
): Option.Option<Message> => {
  if (key === ' ') {
    return Option.some(Message.RequestedStep());
  }
  // Enter goes back to the earlier state looked at, and steps from the newest.
  if (key === 'Enter') {
    return Option.some(
      Option.match(model.maybePicked, {
        onNone: () => Message.RequestedStep(),
        onSome: (index) =>
          index < model.states.length - 1 ? Message.ChoseState({ index }) : Message.RequestedStep(),
      }),
    );
  }
  const from = Option.getOrElse(model.maybePicked, () => model.states.length - 1);
  if (key === 'ArrowLeft' && !modifiers.shiftKey) {
    return Option.some(Message.PointedAtState({ index: Math.max(0, from - 1) }));
  }
  if (key === 'ArrowRight' && !modifiers.shiftKey) {
    return Option.some(
      Message.PointedAtState({ index: Math.min(model.states.length - 1, from + 1) }),
    );
  }
  return Option.none();
};

/** The state press, in its card: the figure, what to do with it, what it reads, and what it shows. */
export const view = defineView<Model, Message>((model, h) => {
  const parts = draw(h);
  const pose = poseOf(model);
  const pressed = pressedOf(model);
  const isPicked = (index: number) => Option.contains(model.maybePicked, index);

  const plates = model.states.map((state, index) => {
    // The newest plate stands under the press, the earlier ones behind it, however few there are yet.
    const slot = SHOWN - model.states.length + index;
    const isLeaving = slot === 0 && pose.leaving > 0;
    const x = (SLOTS[slot] ?? 0) - (isLeaving ? 0 : PITCH * pose.slid);
    const isNow = index === model.states.length - 1 && model.press._tag === 'Resting';
    return h.keyed('g')(
      `plate-${state.tick}`,
      [
        h.Transform(Iso.translateAlong(P, [x, 0, 0])),
        ...(isLeaving ? [h.Opacity(String(1 - pose.leaving))] : []),
        h.OnMouseEnter(Message.PointedAtState({ index })),
        // An earlier state is gone back to, not stepped from, so its click goes no further than the globe.
        ...(index < model.states.length - 1
          ? [h.OnClick(Message.ChoseState({ index }), { propagation: 'Stop' })]
          : []),
        ...Styled.attributes(h, styles.plate),
      ],
      [plateCache(state.tick % PLATE_SLOTS, plateOf, [h, state, isNow || isPicked(index), 1])],
    );
  });

  const made =
    model.press._tag === 'Stepping' && pose.arriving > 0
      ? [
          h.keyed('g')(
            `plate-${model.press.made.tick}`,
            [
              h.Transform(Iso.translateAlong(P, [SLOTS[SHOWN - 1] ?? 0, 0, 0])),
              h.Opacity(String(pose.arriving)),
            ],
            [
              plateCache(model.press.made.tick % PLATE_SLOTS, plateOf, [
                h,
                model.press.made,
                true,
                pose.isStamped ? pose.grown : 0,
              ]),
            ],
          ),
        ]
      : [];

  return h.figure(Styled.attributes(h, styles.figure), [
    h.div(
      [
        h.Tabindex(0),
        h.Role('button'),
        h.AriaLabel(
          'A state press. Press Space to step; the arrow keys look at earlier states, and Enter goes back to the one looked at.',
        ),
        h.OnClick(Message.RequestedStep()),
        h.OnKeyDownPreventDefault((key, modifiers) => keyOf(key, modifiers, model)),
        h.OnMouseLeave(Message.LeftStates()),
        ...Styled.attributes(h, styles.card),
      ],
      [
        h.div(Styled.attributes(h, styles.corners, styles.upper), [
          h.span([], ['Fig 1']),
          h.span(Styled.attributes(h, styles.title), ['State']),
        ]),
        h.svg(
          [
            h.ViewBox(`0 0 ${WIDTH} ${HEIGHT}`),
            h.AriaHidden(true),
            ...Styled.attributes(h, styles.svg),
          ],
          [
            staticBack(backOf, [h]),
            h.g([], [...plates, ...made]),
            h.g(
              [h.Transform(Iso.translateAlong(P, [0, 0, (PAD_DOWN - PAD_REST) * pose.down]))],
              plunger(parts),
            ),
            staticPress(pressOf, [h]),
            counter(h, Option.match(pressed, { onNone: () => 0, onSome: ({ tick }) => tick })),
            ...needle(
              parts,
              Option.match(pressed, { onNone: () => 0, onSome: ({ random }) => random }),
            ),
          ],
        ),
        h.div(Styled.attributes(h, styles.corners, styles.lower), [
          h.span(Styled.attributes(h, styles.hint), [
            'Click to step · click a globe to go back to it',
          ]),
          h.span(Styled.attributes(h, styles.readout), [readoutOf(model)]),
        ]),
      ],
    ),
    h.figcaption(Styled.attributes(h, styles.caption), [
      'A state is one globe and everything on it: a tree, a volcano, a dragon, and a warrior, each an entity holding its components. A step never reworks a globe. It stamps a new one from the last, and the counter and the dial on the press turn to its tick and its random counter. Every earlier state stays as it was. The press is a LightOcean game itself, running in a worker beside this page with its time held: each click asks it for one step, and a click on an earlier globe sends it back there, to step on from it exactly as it did before.',
    ]),
  ]);
});
