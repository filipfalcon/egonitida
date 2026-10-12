import { type Drawing, View } from '@lightocean/client';
import type { Component } from '@lightocean/core';
import { Effect } from 'effect';
import * as Three from 'three/webgpu';
import * as Glance from '#src/glance.ts';

/** The colours of the first game's light, the ideas' strands, the bang, and the planets alike: deep blue, violet, a pink glow, cyan, white, and the warm light of the sun the bang leaves. */
const BLUE = new Three.Color(0x2f5bff);
const VIOLET = new Three.Color(0x8b5cff);
const PINK = new Three.Color(0xff5fae);
const CYAN = new Three.Color(0x5cd6ff);
const WHITE = new Three.Color(0xffffff);
const SUN = new Three.Color(0xffd9a8);

/** The colour a planet of `tint` is, round the ideas' colours. */
const colourOf = (tint: number) => {
  const colours = [CYAN, BLUE, VIOLET, PINK];
  const at = tint * (colours.length - 1);
  const from = colours[Math.floor(at)] ?? CYAN;
  const to = colours[Math.ceil(at)] ?? from;
  return from.clone().lerp(to, at - Math.floor(at));
};

const clamp = (share: number) => Math.min(1, Math.max(0, share));

const ease = (share: number) => {
  const clamped = clamp(share);
  return clamped * clamped * (3 - 2 * clamped);
};

const rate = Glance.game.stepRate;

/** Where the telling is in `frame`: its beat, and how many seconds into it. */
const tellingOf = (frame: Drawing.Frame) => {
  const [telling] = frame.query(Glance.Telling);
  return telling === undefined
    ? { beat: 'Waiting' as const, seconds: 0 }
    : { beat: telling[1].beat, seconds: (frame.tick - telling[1].since) / rate };
};

/** How long the point throbs before it bursts, and how long it takes to burst, slowly, in seconds. */
const POINT_SECONDS = 1.2;
const BURSTING_SECONDS = 5;

/** How many seconds a bang whose state emerged at `since` had been bursting for, `back` steps before `frame`: below zero while it is still a point. */
const burstingAt = (since: number, frame: Drawing.Frame, back = 0) =>
  (frame.tick - back - since) / rate - POINT_SECONDS;

/** Lets go of the geometry and materials `object` built. */
const disposeAll = (object: Three.Object3D): void => {
  if (
    object instanceof Three.Mesh ||
    object instanceof Three.Line ||
    object instanceof Three.Sprite
  ) {
    object.geometry.dispose();
    object.material.dispose();
  }
  for (const child of object.children) {
    disposeAll(child);
  }
};

/** A soft round glow, brightest in the middle and fading to nothing at its edge, as a texture. */
const glowTexture = () => {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const out = Math.hypot(x - size / 2 + 0.5, y - size / 2 + 0.5) / (size / 2);
      data.set([255, 255, 255, Math.round(255 * Math.max(0, 1 - out) ** 2.2)], (y * size + x) * 4);
    }
  }
  const texture = new Three.DataTexture(data, size, size);
  texture.needsUpdate = true;
  return texture;
};

/** One glow texture for the whole page, as every glow is the same shape. */
const GLOW = glowTexture();

/** A glow of `colour`, drawn as light over whatever is behind it. */
const glowOf = (colour: Three.Color, name: string) => {
  const sprite = new Three.Sprite(
    new Three.SpriteNodeMaterial({
      map: GLOW,
      color: colour,
      transparent: true,
      opacity: 0,
      blending: Three.AdditiveBlending,
      depthWrite: false,
    }),
  );
  sprite.name = name;
  return sprite;
};

/** Sets how clear `object` is drawn, if it is a part this module built. */
const setOpacity = (object: Three.Object3D | undefined, opacity: number) => {
  if (
    object instanceof Three.Sprite ||
    object instanceof Three.Mesh ||
    object instanceof Three.Line
  ) {
    if (!Array.isArray(object.material)) {
      object.material.opacity = opacity;
    }
  }
};

/** Lines of light along `positions`, each piece its own colour from `colours`. */
const linesOf = (positions: Float32Array, colours: Float32Array) => {
  const geometry = new Three.BufferGeometry();
  geometry.setAttribute('position', new Three.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Three.BufferAttribute(colours, 3));
  return new Three.LineSegments(
    geometry,
    new Three.LineBasicNodeMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      blending: Three.AdditiveBlending,
      depthWrite: false,
    }),
  );
};

// IDEAS

/** How many strands of light an idea is drawn as, and how many pieces each strand is made of. */
const STRANDS = 14;
const PIECES = 40;

/** How far an idea's strands reach, and how far beyond the edges it drifts in from, in the scene's units. */
const REACH = 4.5;
const BEYOND = 11;

/** How long an idea takes to drift in from beyond the edges, in seconds. */
const DRIFTING_SECONDS = 1.6;

/** A share between 0 and 1, from `seed` and `salt`, so each strand has a shape of its own, and the same one every time it is drawn. */
const shareOf = (seed: number, salt: number) => {
  const wave = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453;
  return wave - Math.floor(wave);
};

/** The point of a cubic curve through four points, at `t`. */
const curveAt = (
  points: ReadonlyArray<readonly [number, number, number]>,
  t: number,
): readonly [number, number, number] => {
  const [a, b, c, d] = points;
  const u = 1 - t;
  const weights = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  const sum = (axis: 0 | 1 | 2) =>
    [a, b, c, d].reduce(
      (total, point, index) => total + (point?.[axis] ?? 0) * (weights[index] ?? 0),
      0,
    );
  return [sum(0), sum(1), sum(2)];
};

/** The strands of an idea from `seed`, as tangled curves round its middle, brighter and pinker toward it: a knot of light. */
const strandsOf = (seed: number) => {
  const positions = new Float32Array(STRANDS * PIECES * 2 * 3);
  const colours = new Float32Array(STRANDS * PIECES * 2 * 3);
  const colour = new Three.Color();
  let at = 0;
  for (let strand = 0; strand < STRANDS; strand++) {
    const share = (salt: number) => shareOf(seed, strand * 13 + salt) - 0.5;
    const out = REACH * (0.5 + shareOf(seed, strand + 70) * 0.6);
    const points = [
      [share(1) * out * 2, share(2) * out, share(3) * out],
      [share(4) * out, share(5) * out, share(6) * out],
      [share(7) * out, share(8) * out, share(9) * out],
      [share(10) * out * 2, share(11) * out, share(12) * out],
    ] as const;
    const tint = shareOf(seed, strand + 100);
    for (let piece = 0; piece < PIECES; piece++) {
      for (const end of [piece, piece + 1]) {
        const t = end / PIECES;
        const [x, y, z] = curveAt(points, t);
        positions.set([x, y, z], at * 3);
        const middle = 1 - Math.abs(t - 0.5) * 2;
        colour
          .copy(tint < 0.25 ? CYAN : BLUE)
          .lerp(VIOLET, Math.min(1, middle * 1.4))
          .lerp(PINK, middle * middle * (tint > 0.6 ? 0.9 : 0.4));
        colour.multiplyScalar(0.3 + middle * 0.7);
        colours.set([colour.r, colour.g, colour.b], at * 3);
        at += 1;
      }
    }
  }
  return { positions, colours };
};

/** How many seconds into their beat the ideas start being pressed together, once they have all come, and how long it takes to press them into a point. */
const PRESSING_FROM = 4;
const PRESSING_SECONDS = 2.5;

/** How far the ideas have been pressed together, in `frame`: not at all while they come, and then, all but wholly, into a point, which they stay pressed into until the viewer goes on. */
const pressedOf = (frame: Drawing.Frame) => {
  const { beat, seconds } = tellingOf(frame);
  return beat === 'Ideas' ? ease((seconds - PRESSING_FROM) / PRESSING_SECONDS) : 0;
};

/** Every idea, as a knot of strands of light drifting in from beyond the edges and tangling with the others into a chaos; pressed, as the beat goes on, ever smaller and brighter into one point. */
export const ideas = View.each([Glance.Idea], {
  acquire: (held) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const { positions, colours } = strandsOf(held(Glance.Idea).seed);
        return linesOf(positions, colours);
      }),
      (lines) => Effect.sync(() => disposeAll(lines)),
    ),
  draw: (lines, held, frame) => {
    const { since, seed } = held(Glance.Idea);
    const seconds = frame.tick / rate;
    const drifted = ease((frame.tick - since) / rate / DRIFTING_SECONDS);
    const pressed = pressedOf(frame);
    const from = seed * Math.PI * 2;
    const away = (1 - drifted) * BEYOND;
    lines.position.set(Math.cos(from) * away, Math.sin(from) * away * 0.6, 0);
    lines.scale.setScalar(Math.max(0.002, 1 - pressed * 0.995));
    lines.rotation.set(
      seconds * 0.4 + seed * 9 + pressed * 6,
      seconds * 0.3 + seed * 5,
      seconds * 0.2 + pressed * 4,
    );
    lines.material.opacity = Math.min(1, drifted * (0.45 + pressed * 0.6));
  },
});

// THE BANG

/** How many shards of light the bang throws out, and how many pieces each is made of. */
const SHARDS = 90;
const SHARD_PIECES = 6;

/** How far the bang's shards fly, how far its flash spreads, and how far its rings run, in the scene's units. */
const SHARD_REACH = 7;
const FLASH_REACH = 6;
const RING_REACH = 8;

/** The shards the bang throws out from `seed`: short streaks, each pointing the way it flies out from the middle, scaled out from it as the bang bursts. */
const shardsOf = (seed: number) => {
  const positions = new Float32Array(SHARDS * SHARD_PIECES * 2 * 3);
  const colours = new Float32Array(SHARDS * SHARD_PIECES * 2 * 3);
  const colour = new Three.Color();
  let at = 0;
  for (let shard = 0; shard < SHARDS; shard++) {
    const theta = shareOf(seed, shard) * Math.PI * 2;
    const phi = Math.acos(shareOf(seed, shard + 300) * 2 - 1);
    const [dx, dy, dz] = [
      Math.sin(phi) * Math.cos(theta),
      Math.cos(phi) * 0.55,
      Math.sin(phi) * Math.sin(theta),
    ];
    const speed = 0.55 + shareOf(seed, shard + 600) * 0.45;
    const tint = shareOf(seed, shard + 900);
    for (let piece = 0; piece < SHARD_PIECES; piece++) {
      for (const end of [piece, piece + 1]) {
        const along = speed * (0.82 + (end / SHARD_PIECES) * 0.18);
        positions.set([dx * along, dy * along, dz * along], at * 3);
        colour
          .copy(tint < 0.3 ? CYAN : tint < 0.7 ? VIOLET : PINK)
          .lerp(WHITE, end / SHARD_PIECES)
          .multiplyScalar(end / SHARD_PIECES);
        colours.set([colour.r, colour.g, colour.b], at * 3);
        at += 1;
      }
    }
  }
  return { positions, colours };
};

/** The parts of the point and its bang: its heart and halo, two rings, its shards, and the sun it leaves. */
const bangParts = (seed: number) => {
  const object = new Three.Group();
  const ring = (name: string, colour: Three.Color, tilt: number) => {
    const mesh = new Three.Mesh(
      new Three.TorusGeometry(1, 0.01, 8, 160),
      new Three.MeshBasicNodeMaterial({
        color: colour,
        transparent: true,
        opacity: 0,
        blending: Three.AdditiveBlending,
        depthWrite: false,
      }),
    );
    mesh.name = name;
    mesh.rotation.x = tilt;
    return mesh;
  };
  const { positions, colours } = shardsOf(seed);
  const shards = linesOf(positions, colours);
  shards.name = 'shards';
  object.add(
    glowOf(VIOLET.clone().lerp(PINK, 0.45), 'halo'),
    glowOf(WHITE, 'heart'),
    ring('ring', CYAN, Math.PI / 2.3),
    ring('wave', PINK, Math.PI / 1.8),
    shards,
    glowOf(SUN, 'sun'),
  );
  return object;
};

/** Draws the point and its bang into `object` as they were `back` steps before `frame`: as the state emerges, a point of light, small and heavy, throbbing; and soon it bursts, slowly, a flash spreading, two rings running out, and shards flying; and where it was, a sun is left, kindling as the burst fades. */
const drawBang = (object: Three.Object3D, since: number, frame: Drawing.Frame, back = 0) => {
  const bursting = burstingAt(since, frame, back);
  const isPoint = bursting < 0;
  const spread = isPoint ? 0 : clamp(bursting / BURSTING_SECONDS);
  const flying = 1 - (1 - spread) ** 3;
  const fading = (1 - spread) ** 1.6;
  const throb = 1 + Math.sin(((frame.tick - back) / rate) * 7) * 0.12;
  const heart = object.getObjectByName('heart');
  const halo = object.getObjectByName('halo');
  heart?.scale.setScalar(isPoint ? 0.32 * throb : 0.32 + flying * FLASH_REACH * 0.35);
  setOpacity(heart, isPoint ? 1 : fading);
  halo?.scale.setScalar(isPoint ? 1.1 * throb : 1.1 + flying * FLASH_REACH);
  setOpacity(halo, 0.7 * (isPoint ? 1 : fading));
  for (const [name, reach, delay] of [
    ['ring', RING_REACH, 0],
    ['wave', RING_REACH * 0.7, 0.12],
  ] as const) {
    const ring = object.getObjectByName(name);
    const running = clamp((spread - delay) / (1 - delay));
    ring?.scale.setScalar(Math.max(0.001, (1 - (1 - running) ** 3) * reach));
    setOpacity(ring, isPoint || running <= 0 ? 0 : (1 - running) ** 1.5 * 0.85);
  }
  const shards = object.getObjectByName('shards');
  shards?.scale.setScalar(Math.max(0.001, flying * SHARD_REACH));
  setOpacity(shards, isPoint ? 0 : fading);
  const sun = object.getObjectByName('sun');
  const kindled = isPoint ? 0 : ease((spread - 0.35) / 0.65);
  sun?.scale.setScalar(Math.max(0.001, kindled * 1.4));
  setOpacity(sun, kindled * 0.9);
};

/** The point the ideas were pressed into, and the bang it bursts in as the state emerges, leaving a sun where it was. */
export const bang = View.each([Glance.Bang], {
  acquire: (held) =>
    Effect.acquireRelease(
      Effect.sync(() => bangParts(held(Glance.Bang).seed)),
      (object) => Effect.sync(() => disposeAll(object)),
    ),
  draw: (object, held, frame) => drawBang(object, held(Glance.Bang).since, frame),
});

// ENTITIES AND THEIR COMPONENTS

/** How long an entity takes to come out of the middle to its place in the row, and a planet to take its look and its place once it is given them, in seconds. */
const EMERGING_SECONDS = 1.1;
const FORMING_SECONDS = 1.8;

/** How large an entity is drawn while it holds nothing but which of them it is, and its colour then, the same for all. */
const BARE_SIZE = 0.2;
const BARE = new Three.Color(0xb8c2dc);

/** How far apart the entities stand in a row, and how far in front of the middle the row stands on the stage. */
const SLOT = 1.25;
const ROW_FRONT = 2.4;

/** Where the `index`th of `count` entities stands in a row, across. */
const slotOf = (index: number, count: number) => (index - (count - 1) / 2) * SLOT;

/** How far an entity that emerged at `since` had come out, `back` steps before `frame`. */
const emergedAt = (frame: Drawing.Frame, since: number, back = 0) =>
  ease((frame.tick - back - since) / rate / EMERGING_SECONDS);

/** How far a planet given its look at `since` had taken it, `back` steps before `frame`. */
const formedAt = (frame: Drawing.Frame, since: number, back = 0) =>
  ease((frame.tick - back - since) / rate / FORMING_SECONDS);

/** Where a planet at `place` stood `back` steps before `frame`, if it was going round then: each step back, a stride back round. */
const standAt = (
  place: Component.ValueOf<typeof Glance.Place>,
  back: number,
  isGoingRound: boolean,
  into: Three.Vector3,
) => {
  const stridden = isGoingRound ? back * Glance.strideAt(place.distance) : 0;
  const round = ((place.angle - stridden) * Math.PI) / 180;
  return into.set(Math.cos(round) * place.distance, place.height, Math.sin(round) * place.distance);
};

/** A globe of radius 1, to be scaled to the size it is drawn at, in `colour`. */
const sphereOf = (colour: Three.Color) => {
  const sphere = new Three.Mesh(
    new Three.SphereGeometry(1, 40, 28),
    new Three.MeshStandardNodeMaterial({
      color: colour,
      emissive: colour.clone().multiplyScalar(0.22),
      roughness: 0.4,
    }),
  );
  sphere.name = 'sphere';
  return sphere;
};

/** Colours `object`'s globe `colour`, if it has one this module built. */
const colourSphere = (object: Three.Object3D, colour: Three.Color) => {
  const sphere = object.getObjectByName('sphere');
  if (sphere instanceof Three.Mesh && sphere.material instanceof Three.MeshStandardNodeMaterial) {
    sphere.material.color.copy(colour);
    sphere.material.emissive.copy(colour).multiplyScalar(0.22);
  }
};

/** A planet's parts: its globe, and a glow round it while it comes, or takes its components. */
const planetParts = () => {
  const object = new Three.Group();
  object.add(sphereOf(BARE), glowOf(WHITE, 'glow'));
  return object;
};

/** Draws an entity into `object` as it was `back` steps before `frame`, holding nothing but which of them it is: out of the middle into its place in the row, alike, grey and small, glowing as it comes. */
const drawBare = (
  object: Three.Object3D,
  body: Component.ValueOf<typeof Glance.Body>,
  frame: Drawing.Frame,
  back = 0,
) => {
  const emerged = emergedAt(frame, body.since, back);
  object.visible = frame.tick - back >= body.since;
  object.position.set(slotOf(body.index, Glance.PLANETS) * emerged, 0, ROW_FRONT * emerged);
  object.scale.setScalar(Math.max(0.001, BARE_SIZE * emerged));
  colourSphere(object, BARE);
  const glow = object.getObjectByName('glow');
  glow?.scale.setScalar(5);
  setOpacity(glow, (1 - emerged) * 0.9 + 0.1);
};

/** Draws a planet into `object` as it was `back` steps before `frame`: from its place in the row, taking its look and its place, its size and its colour, as it is given them; and, once time starts stepping, going round the middle. */
const drawPlanet = (
  object: Three.Object3D,
  body: Component.ValueOf<typeof Glance.Body>,
  look: Component.ValueOf<typeof Glance.Look>,
  place: Component.ValueOf<typeof Glance.Place>,
  frame: Drawing.Frame,
  back = 0,
) => {
  const formed = formedAt(frame, look.since, back);
  object.visible = frame.tick - back >= body.since;
  const row = new Three.Vector3(slotOf(body.index, Glance.PLANETS), 0, ROW_FRONT);
  const standing = standAt(place, back, tellingOf(frame).beat === 'Step', new Three.Vector3());
  object.position.copy(row.lerp(standing, formed));
  object.scale.setScalar(BARE_SIZE + (look.radius - BARE_SIZE) * formed);
  colourSphere(object, BARE.clone().lerp(colourOf(look.tint), formed));
  const glow = object.getObjectByName('glow');
  glow?.scale.setScalar(5);
  setOpacity(glow, Math.sin(formed * Math.PI) * 0.8 + 0.1);
};

/** Every entity on the stage while none holds more than which of them it is: coming out of the middle into a row, alike. Once they are given their components, the planets they become are drawn in their place. */
export const bare = View.each([Glance.Body], {
  acquire: () =>
    Effect.acquireRelease(Effect.sync(planetParts), (object) =>
      Effect.sync(() => disposeAll(object)),
    ),
  draw: (object, held, frame) => {
    drawBare(object, held(Glance.Body), frame);
    // Every entity is given its components in the same step, so while one holds a look, all do.
    object.visible &&= frame.query(Glance.Look).length === 0;
  },
});

/** Every planet, an entity with its look and its place: taking them, and, once time starts stepping, going round the middle. */
export const planets = View.each([Glance.Body, Glance.Look, Glance.Place], {
  acquire: () =>
    Effect.acquireRelease(Effect.sync(planetParts), (object) =>
      Effect.sync(() => disposeAll(object)),
    ),
  draw: (object, held, frame) =>
    drawPlanet(object, held(Glance.Body), held(Glance.Look), held(Glance.Place), frame),
});

// THE STEPS

/** How many steps the film strip shows, the newest last. */
export const FRAMES = 5;

/** How far apart the frames of the strip stand, and how small the state is drawn in each. */
const FRAME_APART = 3.05;
const FRAME_SCALE = 0.2;

/** The state across the last few steps, as a strip of film: in each frame, the state as it was that step, its sun and every planet where that step left it, framed; the newest last, and brightest framed. */
export const film = View.each([Glance.Bang], {
  acquire: (held) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const object = new Three.Group();
        for (let index = 0; index < FRAMES; index++) {
          const panel = new Three.Group();
          panel.name = `frame-${index}`;
          panel.position.x = (index - (FRAMES - 1) / 2) * FRAME_APART;
          const scene = bangParts(held(Glance.Bang).seed);
          scene.name = 'scene';
          scene.scale.setScalar(FRAME_SCALE);
          const shown = new Three.Group();
          shown.name = 'planets';
          shown.scale.setScalar(FRAME_SCALE);
          for (let planet = 0; planet < Glance.PLANETS; planet++) {
            const drawn = planetParts();
            drawn.name = `planet-${planet}`;
            shown.add(drawn);
          }
          const border = new Three.LineLoop(
            new Three.BufferGeometry().setFromPoints([
              new Three.Vector3(-1.45, -1.05, 0),
              new Three.Vector3(1.45, -1.05, 0),
              new Three.Vector3(1.45, 1.05, 0),
              new Three.Vector3(-1.45, 1.05, 0),
            ]),
            new Three.LineBasicNodeMaterial({
              color: CYAN,
              transparent: true,
              opacity: index === FRAMES - 1 ? 0.85 : 0.3,
            }),
          );
          panel.add(border, scene, shown);
          object.add(panel);
        }
        return object;
      }),
      (object) => Effect.sync(() => disposeAll(object)),
    ),
  draw: (object, held, frame) => {
    const planetsThere = frame.query(Glance.Body, Glance.Look, Glance.Place);
    for (let index = 0; index < FRAMES; index++) {
      const panel = object.getObjectByName(`frame-${index}`);
      const back = FRAMES - 1 - index;
      const scene = panel?.getObjectByName('scene');
      if (scene !== undefined) {
        drawBang(scene, held(Glance.Bang).since, frame, back);
      }
      const shown = panel?.getObjectByName('planets');
      for (let planet = 0; planet < Glance.PLANETS; planet++) {
        const drawn = shown?.getObjectByName(`planet-${planet}`);
        const there = planetsThere[planet];
        if (drawn !== undefined) {
          if (there === undefined) {
            drawn.visible = false;
          } else {
            drawPlanet(drawn, there[1], there[2], there[3], frame, back);
          }
        }
      }
    }
  },
});

// THE ARRAYS

/** How far round the small path each planet goes in its slot of the array of components. */
const SLOT_PATH = 0.32;

/** Every entity on its own, out of the state, in its slot of an array of the entities: alike, grey, holding nothing but which of them it is. */
export const entityArray = View.each([Glance.Body], {
  acquire: () =>
    Effect.acquireRelease(Effect.sync(planetParts), (object) =>
      Effect.sync(() => disposeAll(object)),
    ),
  draw: (object, held, frame) => {
    const body = held(Glance.Body);
    const emerged = emergedAt(frame, body.since);
    object.position.set(slotOf(body.index, frame.query(Glance.Body).length), 0, 0);
    object.scale.setScalar(Math.max(0.001, 0.26 * emerged));
    colourSphere(object, BARE);
    setOpacity(object.getObjectByName('glow'), 0);
  },
});

/** Every planet on its own, out of the state, in its slot of the same array, holding its components: as large and of the colour its look says, and round a small path at the angle its place says, going round as it does in the state. */
export const componentArray = View.each([Glance.Body, Glance.Look, Glance.Place], {
  acquire: () =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const object = new Three.Group();
        const planet = planetParts();
        planet.name = 'planet';
        const path = new Three.LineLoop(
          new Three.BufferGeometry().setFromPoints(
            Array.from({ length: 64 }, (_, index) => {
              const round = (index / 64) * Math.PI * 2;
              return new Three.Vector3(Math.cos(round) * SLOT_PATH, 0, Math.sin(round) * SLOT_PATH);
            }),
          ),
          new Three.LineBasicNodeMaterial({ color: CYAN, transparent: true, opacity: 0.35 }),
        );
        object.add(planet, path);
        return object;
      }),
      (object) => Effect.sync(() => disposeAll(object)),
    ),
  draw: (object, held, frame) => {
    const body = held(Glance.Body);
    const look = held(Glance.Look);
    const formed = formedAt(frame, look.since);
    object.position.set(slotOf(body.index, frame.query(Glance.Body).length), 0, 0);
    const planet = object.getObjectByName('planet');
    if (planet !== undefined) {
      const round = (held(Glance.Place).angle * Math.PI) / 180;
      planet.position.set(Math.cos(round) * SLOT_PATH, 0, Math.sin(round) * SLOT_PATH);
      planet.scale.setScalar(0.26 + (Math.min(0.42, look.radius * 1.4) - 0.26) * formed);
      colourSphere(planet, BARE.clone().lerp(colourOf(look.tint), formed));
      setOpacity(planet.getObjectByName('glow'), 0);
    }
  },
});

/** A glyph of light through `points`, flat toward the viewer. */
const glyphOf = (points: ReadonlyArray<readonly [number, number]>, name: string) => {
  const line = new Three.Line(
    new Three.BufferGeometry().setFromPoints(points.map(([x, y]) => new Three.Vector3(x, y, 0))),
    new Three.LineBasicNodeMaterial({ color: WHITE, transparent: true, opacity: 0.7 }),
  );
  line.name = name;
  return line;
};

/** The brackets an array of entities stands between, and the commas between its entities, spread to however many there are. */
export const delimiters = View.each([Glance.Bang], {
  acquire: () =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const object = new Three.Group();
        const bracket = (side: number): ReadonlyArray<readonly [number, number]> => [
          [side * 0.18, 0.62],
          [0, 0.62],
          [0, -0.62],
          [side * 0.18, -0.62],
        ];
        object.add(glyphOf(bracket(1), 'open'), glyphOf(bracket(-1), 'close'));
        for (let comma = 0; comma < Glance.PLANETS - 1; comma++) {
          object.add(
            glyphOf(
              [
                [0.03, -0.28],
                [0, -0.36],
                [-0.05, -0.46],
              ],
              `comma-${comma}`,
            ),
          );
        }
        return object;
      }),
      (object) => Effect.sync(() => disposeAll(object)),
    ),
  draw: (object, _held, frame) => {
    const count = frame.query(Glance.Body).length;
    object.visible = count > 0;
    const edge = slotOf(count - 1, count) + SLOT * 0.62;
    object.getObjectByName('open')?.position.set(-edge, 0, 0);
    object.getObjectByName('close')?.position.set(edge, 0, 0);
    for (let comma = 0; comma < Glance.PLANETS - 1; comma++) {
      const glyph = object.getObjectByName(`comma-${comma}`);
      if (glyph !== undefined) {
        glyph.visible = comma < count - 1;
        glyph.position.set(slotOf(comma, count) + SLOT / 2, 0, 0);
      }
    }
  },
});

// THE EYES

/** A camera standing still at `at`, looking at `toward`, for a pane that shows the state from a place of its own. */
const fixed = (at: Three.Vector3, toward: Three.Vector3) =>
  View.rig([Glance.Eye], (camera) => {
    camera.position.copy(at);
    camera.lookAt(toward);
  });

/** The camera of the stage, wide enough to see the whole bang and every planet going round. */
export const eye = fixed(new Three.Vector3(0, 3.2, 8.6), new Three.Vector3(0, -0.2, 0));

/** The camera of an array of entities, square in front of it. */
export const arrayEye = fixed(new Three.Vector3(0, 0.9, 6.2), new Three.Vector3(0, 0, 0));

/** How far out the film strip reaches either way from its middle, across and up, with a little room round it. */
const FILM_REACH = { across: ((FRAMES - 1) / 2) * FRAME_APART + 1.6, up: 1.2 };

/** The camera of the film strip, square in front of it, as near as lets the whole strip in, however wide its pane. */
export const filmEye = View.rig([Glance.Eye], (camera) => {
  const slope = Math.tan(Three.MathUtils.degToRad(camera.fov / 2));
  const distance = Math.max(FILM_REACH.up / slope, FILM_REACH.across / (slope * camera.aspect));
  camera.position.set(0, 0, distance);
  camera.lookAt(0, 0, 0);
});

/** How much more the stage's eye takes in than the pane's, and how far down its view reaches below what that eye sees, as shares of what that eye sees: so the whole state is drawn above the band along the stage's foot that its lines are told in. */
const STAGE_WIDER = 1.45;
const STAGE_FOOT = 0.4;

/** The camera of the stage: the pane's eye, taking in more, its view reaching further down, so the state stands in the stage above its lines. */
export const stageEye = View.rig([Glance.Eye], (camera) => {
  camera.position.set(0, 3.2, 8.6);
  camera.lookAt(0, -0.2, 0);
  camera.setViewOffset(
    camera.aspect,
    1,
    (camera.aspect * (1 - STAGE_WIDER)) / 2,
    1 + STAGE_FOOT - STAGE_WIDER,
    camera.aspect * STAGE_WIDER,
    STAGE_WIDER,
  );
});

/** The views of the first game on the stage: its ideas, the point they are pressed into and the bang it bursts in, the planets that emerge from it, and the eye that looks at them from above the stage's lines. */
export const views = [ideas, bang, bare, planets, stageEye];

/** The views of the pane for a state: the same state as the stage's, from the eye at its middle. */
export const stateViews = [ideas, bang, bare, planets, eye];

/** The views of the pane for a step: the bang across the last few steps, a frame to a step. */
export const stepViews = [film, filmEye];

/** The views of the pane for an entity: the entities in an array, alike. */
export const entityViews = [entityArray, delimiters, arrayEye];

/** The views of the pane for a component: the same array, every entity holding its components. */
export const componentViews = [componentArray, delimiters, arrayEye];
