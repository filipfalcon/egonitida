import {
  Action,
  Ball as Flight,
  Chain,
  Component,
  Domain,
  Game,
  Maths,
  Pose,
  Quaternion,
  Reach,
  Rule,
  State,
  Strands,
  System,
  Touch,
} from '@egonitida/core';
import { Option, Schema } from 'effect';
import * as Body from '#src/body.ts';

/**
 * The seventh example: a baller doing tricks with a ball, her legs worked by the player, one stick each. A stick places its foot, ahead and back, out and in, and a trigger lifts it; her hip, knee, and ankle turn as a leg turns to put it there, never further than a leg turns, and the rest of her goes with it: her trunk turning against the swinging leg, her arms swinging against it, her shoulders following her arms, and her weight over the foot she stands on. The state holds only where her feet are headed, as they go toward where the sticks place them at a foot's pace: her pose is worked out from that, by reaching, in the step as in the view, so a touch of the ball is the simulation's to decide. Whatever part of her boot or leg touches the ball strikes it, as fast as that part moves and gripping it as that part grips, and the ball flies, spins, bounces, and rolls; the player puts it back before her at a press, or drops it onto her foot to juggle; and she walks where the player sends her. Her hair swings as only her client sees it: her ponytail as a chain, and the guides her hair is drawn after, tied to her head and down her ponytail, kept out of her head, neck, back, and shoulders.
 */

/** How far a stick places its foot from where it stands: ahead or back, and out or in, at a full tilt, and how high a trigger lifts it, in metres. */
export const REACH = { ahead: 0.45, across: 0.3, lift: 0.45 };

/** How fast a foot goes at most toward where its stick places it, in metres a second, as a stick or a trigger moved all at once sends it. */
export const FOOT_SPEED = 5;

/** How long a foot takes to go most of the way toward where its stick places it, in seconds: its pace is how far it has to go over this, so a trigger pressed a little lifts it gently, touching the ball softly, and one pressed fully kicks it up. */
export const FOOT_EASE = 0.06;

/** How fast she walks, at a full press, in metres a second. */
export const WALK_SPEED = 1.5;

/** Where each foot stands as she stands still, its ankle over the ground. */
export const STANDING = Body.standing;

/** Where the ball is put, at rest before her, from where she stands. */
export const BALL_START = { x: 0, y: Flight.football.radius, z: 0.5 };

/** Where the top of her left instep is as she stands, from where she stands: what a ball dropped onto her foot falls onto. */
export const INSTEP = (() => {
  const instep = Body.touches['instep_l'];
  const bone =
    instep === undefined ? undefined : Pose.placer(Body.bones, Body.joints, Pose.rest)(instep.bone);
  if (instep === undefined || bone === undefined) {
    return Body.standing.left;
  }
  const on = Quaternion.rotate(bone.turn, instep.at);
  return { x: bone.at.x + on.x, y: bone.at.y + on.y + instep.radius, z: bone.at.z + on.z };
})();

/** How high a foot is lifted before it points its toes down all the way, its instep facing up, in metres. */
const POINTED_BY = 0.1;

/** The way the instep of the foot `suffix` names faces as she stands, its sole on the ground: up and ahead, as the top of a boot slopes to its toes; straight up, if she has no instep. */
const flatInstep = (suffix: string): Pose.Pose['at'] => {
  const point = Body.touches[`instep_${suffix}`];
  const bone =
    point === undefined ? undefined : Pose.placer(Body.bones, Body.joints, Pose.rest)(point.bone);
  return point === undefined || bone === undefined
    ? { x: 0, y: 1, z: 0 }
    : Quaternion.rotate(bone.turn, point.normal);
};
const FLAT_INSTEP = { l: flatInstep('l'), r: flatInstep('r') };

/** Where over her left instep a ball is dropped, from where she stands: ahead of her standing foot, where a stick held half ahead puts it, clear of her shin and her hand, and how high, in metres. */
export const DROP_AHEAD = 0.4;
export const DROP_HEIGHT = 0.6;

const Point = Schema.Struct({ x: Schema.Finite, y: Schema.Finite, z: Schema.Finite });
const Ground = Schema.Struct({ x: Schema.Finite, z: Schema.Finite });
const Placing = Schema.Struct({ x: Schema.Finite, y: Schema.Finite, lift: Schema.Finite });

/** Where a stick places a foot: across, right as it grows, and ahead, each from −1 to 1, and how far its trigger lifts it, from nothing to a whole. */
export type Placing = typeof Placing.Type;

// COMPONENTS

/** What the player demands of her feet: where each stick places its foot, across, right as it grows, and ahead, each from −1 to 1, and how far its trigger lifts it, from nothing to a whole. */
export const Feet = Component.make('Feet', Schema.Struct({ left: Placing, right: Placing }), {
  owner: 'demand',
  network: 'predicted',
});

/** What the player demands of her walking: which way, across, right as it grows, and ahead, each from −1 to 1. */
export const Walk = Component.make('Walk', Schema.Struct({ x: Schema.Finite, y: Schema.Finite }), {
  owner: 'demand',
  network: 'predicted',
});

/** Where she stands on the ground, in metres: she walks from here, her feet are placed from here, and her pose stands here. */
export const Spot = Component.make('Spot', Ground, { owner: 'simulation', network: 'server' });

/** Where each of her feet is headed now, its ankle, in metres: going toward where the sticks place it, at a foot's pace. Her pose is worked out from it. */
export const Aim = Component.make('Aim', Schema.Struct({ left: Point, right: Point }), {
  owner: 'simulation',
  network: 'server',
});

/** The ball, in flight or at rest. */
export const Ball = Component.make('Ball', Flight.Ball, { owner: 'simulation', network: 'server' });

/** Where the player last put the ball: nowhere yet, or at a point, still, at a tick, for the step to put it there then; above the ground, it falls. */
export const Kickoff = Component.make(
  'Kickoff',
  Schema.Union([
    Schema.TaggedStruct('Never', {}),
    Schema.TaggedStruct('Put', { tick: Schema.Int, at: Point }),
  ]),
  { owner: 'rules', network: 'server' },
);

/** How her ponytail swings: hanging from her hair tie in five links, springing back toward how it hung as made, a little, and bending no further than 70° from it. */
export const ponytail = Chain.plan(
  Body.bones,
  ['ponytail_01', 'ponytail_02', 'ponytail_03', 'ponytail_04', 'ponytail_05'],
  { stiffness: 3, limit: (70 * Math.PI) / 180, damping: 0.03 },
);

/** How her hair's guides swing: springing back toward how they were groomed, a point of a whole stiffness a third of the way each tenth of a second, and losing a little of their swing each step. */
export const swinging: Strands.Options = { stiffness: 30, damping: 0.02 };

/** The bones whose flesh her hair is kept out of: her head, her neck, the top of her back, and her shoulders. */
export const HAIR_COLLIDES = [
  'head',
  'neck_01',
  'neck_02',
  'spine_04',
  'spine_03',
  'clavicle_l',
  'clavicle_r',
  'upperarm_l',
  'upperarm_r',
];

/** Her hair as her client sees it, swinging as she moves: her ponytail's chain, swinging from her hair tie, and her hair's guides, tied to her head and down her ponytail. Only the client draws it, so it is its alone, stepped after every step, never sent; and drawn as the last step left it, never worked out between two, as the body it hangs from is. */
export const Hair = Component.make(
  'Hair',
  Schema.Struct({ body: Chain.Body, guides: Strands.Body }).annotate({ interpolate: 'previous' }),
  { owner: 'simulation', network: 'local' },
);

/** Her whole body as her client draws it, as `drawnPoseOf` poses it after every step: worked out once a step, where her hair is swung from it too, and drawn as the last step left it, never worked out again between two. */
export const Posture = Component.make('Posture', Pose.Pose.annotate({ interpolate: 'previous' }), {
  owner: 'simulation',
  network: 'local',
});

/** Her feet at rest, where they stand. */
export const idle: Component.ValueOf<typeof Feet> = {
  left: { x: 0, y: 0, lift: 0 },
  right: { x: 0, y: 0, lift: 0 },
};

// ACTIONS

/** The player put the ball back before her. */
export const ReplacedBall = Action.make('ReplacedBall', {});

/** The player dropped the ball before her left foot, for her to meet it. */
export const DroppedBall = Action.make('DroppedBall', {});

// POSE

/** Where `placing` places a foot standing at `standing`: right as its stick goes right, which is toward her right, ahead as it goes up, and up as its trigger lifts it. */
const placed = (standing: Pose.Pose['at'], placing: Placing) => ({
  x: standing.x - placing.x * REACH.across,
  y: standing.y + Math.min(Math.max(placing.lift, 0), 1) * REACH.lift,
  z: standing.z + placing.y * REACH.ahead,
});

/** `point` moved to where she stands, `spot`. */
const from = (spot: typeof Ground.Type, point: Pose.Pose['at']) => ({
  x: point.x + spot.x,
  y: point.y,
  z: point.z + spot.z,
});

/** Where `feet` place her feet, standing at `spot`, the origin unless given. */
export const targetOf = (
  feet: Component.ValueOf<typeof Feet>,
  spot: typeof Ground.Type = { x: 0, z: 0 },
): Component.ValueOf<typeof Aim> => ({
  left: from(spot, placed(STANDING.left, feet.left)),
  right: from(spot, placed(STANDING.right, feet.right)),
});

/** Where her feet stand still, standing at `spot`. */
export const standingAt = (spot: typeof Ground.Type): Component.ValueOf<typeof Aim> =>
  targetOf(idle, spot);

/** `from` gone toward `to`, `by` at most, stopping on it. */
const toward = (from: Pose.Pose['at'], to: Pose.Pose['at'], by: number) => {
  const way = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
  const far = Maths.hypot(way.x, way.y, way.z);
  return far <= by
    ? to
    : {
        x: from.x + (way.x * by) / far,
        y: from.y + (way.y * by) / far,
        z: from.z + (way.z * by) / far,
      };
};

/** A foot at `from` gone toward `to` for `seconds`, as fast as it has far to go over `FOOT_EASE`, but no faster than `FOOT_SPEED`, and no slower than a tenth of a metre a second, so it gets there. */
const eased = (from: Pose.Pose['at'], to: Pose.Pose['at'], seconds: number) =>
  toward(
    from,
    to,
    Math.min(
      Math.max(Maths.hypot(to.x - from.x, to.y - from.y, to.z - from.z) / FOOT_EASE, 0.1),
      FOOT_SPEED,
    ) * seconds,
  );

/** Degrees, as radians. */
const degrees = (angle: number) => (angle * Math.PI) / 180;

/** The spine's joints, from the pelvis up, which spread her trunk's turn, lean, and bend. */
const SPINE = ['spine_01', 'spine_02', 'spine_03', 'spine_04'];

/** How long her leg is, at full stretch, from hip to ankle, as her model was made, a little short of it, so a reach to it is a reach within it. */
const LEG = (() => {
  const apart = (a: string, b: string) => {
    const from = Body.bones[a]?.at;
    const to = Body.bones[b]?.at;
    return from === undefined || to === undefined
      ? 0
      : Maths.hypot(from.x - to.x, from.y - to.y, from.z - to.z);
  };
  return (apart('thigh_l', 'calf_l') + apart('calf_l', 'foot_l')) * 0.99;
})();

/** How low she crouches at most, her standing knee bent, to reach low with the other foot, in metres. */
const CROUCH = 0.25;

/** How far a foot has gone from where it stands, for her to stand over the other: past this, in metres, she stands wholly over it. */
const SHIFTED_BY = 0.15;

/** A finger's joints as they hang relaxed: each bent a little more toward its tip. */
const relaxed = (finger: string, suffix: string) => ({
  [`${finger}_01_${suffix}`]: { flex: degrees(12) },
  [`${finger}_02_${suffix}`]: { flex: degrees(22) },
  [`${finger}_03_${suffix}`]: { flex: degrees(18) },
});

/** A hand as it hangs relaxed. */
const hand = (suffix: string) => ({
  ...relaxed('index', suffix),
  ...relaxed('middle', suffix),
  ...relaxed('ring', suffix),
  ...relaxed('pinky', suffix),
  [`hand_${suffix}`]: { flex: degrees(8) },
});

/** `a` and `b` as far between them as `t`. */
const between = (a: Pose.Pose['at'], b: Pose.Pose['at'], t: number) => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});

/**
 * Her whole body posed as her feet are headed, `where` says, standing at `spot`: the leg whose foot has gone further from where it stands swings, the other stands. Her trunk turns against the swinging leg and leans toward the foot she stands on, spread over her spine; her arms come down by her sides, the one across from the swinging leg swinging forward and the one beside it back and out, her elbows bent as a runner's are, her shoulders following her arms; her hands hang relaxed; each leg reaches where its foot is headed, its knee ahead and, as far as her ankle turns, its sole to the ground, or, lifted, its toes pointed until its instep faces up, as a juggler holds a foot; and, as far as the swinging foot has gone, she stands over the other, as far as the swinging leg still reaches from there, crouching as low as it needs to reach.
 */
export const poseOf = (
  where: Component.ValueOf<typeof Aim>,
  spot: typeof Ground.Type = { x: 0, z: 0 },
): Pose.Pose => {
  const known = posed.get(where);
  if (known !== undefined && known.x === spot.x && known.z === spot.z) {
    return known.pose;
  }
  const atOrigin = posedAt({
    left: from({ x: -spot.x, z: -spot.z }, where.left),
    right: from({ x: -spot.x, z: -spot.z }, where.right),
  });
  const pose = { ...atOrigin, at: from(spot, atOrigin.at) };
  posed.set(where, { x: spot.x, z: spot.z, pose });
  return pose;
};

/** The pose last worked out for each aim her feet were headed by, and where she stood for it: a pose is worked out from those alone, so her step, her client, and her drawing, posing her by the same aim, work it out once between them. */
const posed = new WeakMap<
  Component.ValueOf<typeof Aim>,
  { readonly x: number; readonly z: number; readonly pose: Pose.Pose }
>();

/** Her whole body posed as `poseOf` poses it, standing at the origin, her feet headed where `aim` says from there. */
const posedAt = (aim: Component.ValueOf<typeof Aim>): Pose.Pose => {
  const away = (foot: 'left' | 'right') => {
    const from = STANDING[foot];
    const to = aim[foot];
    return { ahead: to.z - from.z, far: Maths.hypot(to.x - from.x, to.y - from.y, to.z - from.z) };
  };
  const left = away('left');
  const right = away('right');
  const swinging = left.far >= right.far ? 'l' : 'r';
  const swing = swinging === 'l' ? left : right;
  // +1 as her left leg swings, −1 as her right does; how far ahead it swings, from −1 to 1.
  const side = swinging === 'l' ? 1 : -1;
  const ahead = Math.min(Math.max(swing.ahead / REACH.ahead, -1), 1);
  const lean = Math.min(swing.far / SHIFTED_BY, 1);
  const posture: Pose.Pose = {
    ...Pose.rest,
    turns: {
      ...hand('l'),
      ...hand('r'),
      [`upperarm_${swinging}`]: {
        flex: degrees(-25) * ahead,
        abduct: degrees(10 + 25 * lean),
      },
      [`upperarm_${swinging === 'l' ? 'r' : 'l'}`]: {
        flex: degrees(35) * ahead,
        abduct: degrees(10),
      },
      lowerarm_l: { flex: degrees(50 + 20 * lean) },
      lowerarm_r: { flex: degrees(50 + 20 * lean) },
    },
  };
  const trunk = Reach.spine(Body.joints, posture, {
    joints: SPINE,
    motions: {
      // Against the swinging leg, toward her left as it grows; leaning toward the foot she stands on; a little forward.
      turn: -side * ahead * degrees(15),
      bend: -side * lean * degrees(6),
      flex: degrees(4) * lean,
    },
  }).pose;
  // Each leg reaching where its foot is headed, its knee bending ahead, facing as far as her ankle turns; how far short the swinging one fell.
  const legs = (pose: Pose.Pose) => {
    const reach = (posed: Pose.Pose, suffix: 'l' | 'r', to: Pose.Pose['at']) => {
      // Its sole down on the ground; lifted, its toes pointed, its instep turning up as it rises until it faces straight up.
      const lifted = Math.min(
        Math.max((to.y - STANDING[suffix === 'l' ? 'left' : 'right'].y) / POINTED_BY, 0),
        1,
      );
      const sole = Body.touches[`sole_${suffix}`];
      const instep = Body.touches[`instep_${suffix}`];
      const surface = lifted > 0 && instep !== undefined ? instep : sole;
      const way =
        surface === instep
          ? between(FLAT_INSTEP[suffix], { x: 0, y: 1, z: 0 }, lifted)
          : { x: 0, y: -1, z: 0 };
      return Reach.limb(Body.bones, Body.joints, posed, {
        root: `thigh_${suffix}`,
        end: `foot_${suffix}`,
        to,
        swivel: { x: to.x, y: to.y + 0.4, z: to.z + 1 },
        facing:
          surface === undefined
            ? undefined
            : {
                bone: surface.bone,
                normal: surface.normal,
                toward: way,
                turning: [`foot_${suffix}`, `subtalar_${suffix}`],
              },
      });
    };
    const left = reach(pose, 'l', aim.left);
    const right = reach(left.pose, 'r', aim.right);
    return { pose: right.pose, short: swinging === 'l' ? left.short : right.short };
  };
  const reached = legs(trunk);
  if (lean === 0) {
    return Pose.follow(Body.bones, Body.joints, reached.pose);
  }
  // Over the foot she stands on, as far as the other has gone, but no further than the swinging leg still reaches where it is headed from there, her lean halved until it does; her shoulders and the bones that twist with her following last.
  const stance = swinging === 'l' ? 'r' : 'l';
  const balanced = Reach.balance(Body.bones, Body.joints, reached.pose, {
    stance: { root: `thigh_${stance}`, end: `foot_${stance}` },
    passes: 2,
  });
  const leaning = (share: number, tries: number): Pose.Pose => {
    const leant = legs({ ...reached.pose, at: between(reached.pose.at, balanced.at, share) });
    return leant.short <= reached.short + 0.002 || tries === 0
      ? leant.pose
      : leaning(share / 2, tries - 1);
  };
  const leant = leaning(lean, 3);
  // Crouched as low as the swinging foot needs to reach where it is headed, her standing knee bending, no lower than she crouches.
  const hip = Pose.placer(Body.bones, Body.joints, leant)(`thigh_${swinging}`);
  const to = aim[swinging === 'l' ? 'left' : 'right'];
  const across = hip === undefined ? 0 : Maths.hypot(hip.at.x - to.x, hip.at.z - to.z);
  const above = hip === undefined ? 0 : hip.at.y - to.y;
  const most = across >= LEG ? 0 : Math.sqrt(LEG * LEG - across * across);
  const drop = Math.min(Math.max(above - most, 0), CROUCH);
  return Pose.follow(
    Body.bones,
    Body.joints,
    drop === 0 ? leant : legs({ ...leant, at: { ...leant.at, y: leant.at.y - drop } }).pose,
  );
};

// RULES

/** Where she who acted stands: where she was placed, or the origin. */
const spotOf = (
  context: {
    readonly get: (
      entity: State.Entity,
      component: typeof Spot,
    ) => Option.Option<typeof Ground.Type>;
  },
  player: State.Entity,
) => Option.getOrElse(context.get(player, Spot), () => ({ x: 0, z: 0 }));

/** A ball put back is put at rest before her who put it back, at this tick, which the step puts there. */
const replaceBall = Rule.on(ReplacedBall, {
  reads: [Spot],
  writes: [Kickoff],
  emits: [],
  run: (context, { player }) => {
    const at = from(spotOf(context, player), BALL_START);
    for (const [ball] of context.query(Kickoff)) {
      context.set(ball, Kickoff, { _tag: 'Put', tick: context.time.tick, at });
    }
  },
});

/** A ball dropped is put ahead of the left instep of her who dropped it, where a stick held half ahead puts her foot, at this tick, which the step lets fall from there. */
const dropBall = Rule.on(DroppedBall, {
  reads: [Spot],
  writes: [Kickoff],
  emits: [],
  run: (context, { player }) => {
    const over = from(spotOf(context, player), INSTEP);
    const at = {
      x: over.x,
      y: over.y + Flight.football.radius + DROP_HEIGHT,
      z: over.z + DROP_AHEAD,
    };
    for (const [ball] of context.query(Kickoff)) {
      context.set(ball, Kickoff, { _tag: 'Put', tick: context.time.tick, at });
    }
  },
});

// SYSTEMS

/**
 * She walks where she is sent, at a walk's pace; her feet go toward where the sticks place them from where she stands, at a foot's pace; a ball put somewhere this tick is put there, still; whatever part of her touches the ball, swept from her pose before to her pose now, strikes it, as fast as that part moves and gripping it as that part grips; and the ball flies on.
 */
const play = System.make({
  name: 'play',
  reads: [Feet, Walk, Kickoff],
  writes: [Spot, Aim, Ball],
  emits: [],
  run: (context) => {
    const seconds = context.time.secondsPerStep;
    const moved = context.query(Feet, Walk, Spot, Aim).map(([baller, feet, walk, spot, aim]) => {
      // No faster for a press of two ways at once.
      const pressed = Math.max(Maths.hypot(walk.x, walk.y), 1);
      const walked = {
        x: spot.x - (walk.x / pressed) * WALK_SPEED * seconds,
        z: spot.z + (walk.y / pressed) * WALK_SPEED * seconds,
      };
      const target = targetOf(feet, walked);
      const now = {
        left: eased(aim.left, target.left, seconds),
        right: eased(aim.right, target.right, seconds),
      };
      context.set(baller, Spot, walked);
      context.set(baller, Aim, now);
      return { before: poseOf(aim, spot), now: poseOf(now, walked) };
    });
    for (const [ball, kickoff, flown] of context.query(Kickoff, Ball)) {
      const flying =
        kickoff._tag === 'Put' && kickoff.tick === context.time.tick
          ? Flight.at(kickoff.at)
          : flown;
      const struck = moved.reduce(
        (now, { before, now: posed }) =>
          Option.match(
            Touch.of(
              Body.bones,
              Body.joints,
              Body.touches,
              before,
              posed,
              { at: now.at, radius: Flight.football.radius },
              seconds,
            ),
            {
              onNone: () => now,
              onSome: (touched) =>
                Flight.struck(
                  Flight.football,
                  now,
                  Body.flatOf(touched),
                  Body.gripOf(touched.part),
                ),
            },
          ),
        flying,
      );
      context.set(
        ball,
        Ball,
        Flight.step(Flight.football, struck, seconds, { floor: 0, walls: [] }),
      );
    }
  },
});

/** What her eyes look with: each eye, looking along its own +y, and her neck, which turns her head for what they cannot reach. */
export const LOOKING = {
  eyes: ['eye_l', 'eye_r'],
  forward: { x: 0, y: 1, z: 0 },
  neck: ['neck_01', 'neck_02', 'head'],
};

/** Her whole body as she is drawn: posed as `poseOf` poses her, her eyes on the ball at `ball`, if there is one, and her head after them, which only her client sees, so her hair hangs from her head where it is drawn. */
export const drawnPoseOf = (
  where: Component.ValueOf<typeof Aim>,
  spot: typeof Ground.Type,
  ball: Option.Option<Pose.Pose['at']>,
): Pose.Pose => {
  const pose = poseOf(where, spot);
  if (Option.isNone(ball)) {
    return pose;
  }
  const at = ball.value;
  const known = looked.get(pose);
  if (known !== undefined && known.x === at.x && known.y === at.y && known.z === at.z) {
    return known.pose;
  }
  const looking = Reach.look(Body.bones, Body.joints, pose, { ...LOOKING, at }).pose;
  looked.set(pose, { ...at, pose: looking });
  return looking;
};

/** How each pose last looked at a ball, and where that ball was: her client and her drawing, looking from the same pose at the same ball, work it out once between them. */
const looked = new WeakMap<
  Pose.Pose,
  { readonly x: number; readonly y: number; readonly z: number; readonly pose: Pose.Pose }
>();

/** Where the bones carrying her hair are placed, posed as `pose` says, her ponytail's bones where its chain `ponytailBody` swings. */
export const hairPlacing = (pose: Pose.Pose, ponytailBody: Chain.Body): Pose.Placer => {
  const posed = Pose.placer(Body.bones, Body.joints, pose);
  const tie = Option.getOrUndefined(Option.map(ponytail.from, posed));
  const swung =
    tie === undefined ? () => undefined : Chain.placing(ponytail, ponytailBody, Body.bones, tie);
  return (name) => swung(name) ?? posed(name);
};

/** Her body is posed as she is drawn, looking at the ball, and kept for her drawing; and her hair swings from it: her ponytail from her hair tie, tied to it where it was made, the rest trailing as she moves; and her hair's guides, tied where her head and her ponytail hold them, kept out of her head, neck, back, and shoulders. */
const swingHair = System.make({
  name: 'swingHair',
  reads: [Aim, Spot, Ball],
  writes: [Hair, Posture],
  emits: [],
  run: (context) => {
    const seconds = context.time.secondsPerStep;
    const [first] = context.query(Ball);
    const ball = Option.map(Option.fromNullishOr(first), ([, flying]) => flying.at);
    for (const [baller, aim, spot] of context.query(Aim, Spot)) {
      const looking = drawnPoseOf(aim, spot, ball);
      context.set(baller, Posture, looking);
      const posed = Pose.placer(Body.bones, Body.joints, looking);
      const tie = Option.getOrUndefined(Option.map(ponytail.from, posed));
      if (tie === undefined) {
        continue;
      }
      const was = Option.getOrUndefined(context.get(baller, Hair));
      const body =
        was === undefined
          ? Chain.start(ponytail, tie)
          : Chain.step(ponytail, was.body, seconds, tie);
      const swung = Chain.placing(ponytail, body, Body.bones, tie);
      const placing: Pose.Placer = (name) => swung(name) ?? posed(name);
      const guides =
        was === undefined
          ? Strands.start(Body.hair.guides, Body.bones, placing)
          : Strands.step(
              Body.hair.guides,
              was.guides,
              seconds,
              Body.bones,
              placing,
              Strands.capsulesOf(Body.joints, posed, HAIR_COLLIDES),
              swinging,
            );
      context.set(baller, Hair, { body, guides });
    }
  },
});

// DOMAIN

export const domain = Domain.make({
  name: 'Baller',
  requires: [],
  components: [Feet, Walk, Spot, Aim, Ball, Kickoff, Hair, Posture],
  actions: [ReplacedBall, DroppedBall],
  events: [],
  systems: [play],
  rules: [replaceBall, dropBall],
  localSystems: [swingHair],
});

export const game = Game.make({ stepRate: 60, domains: [domain] });

/** The pitch, and its ball, at rest, waiting for her. */
export const [state, ball] = State.spawn(State.empty({ seed: 1 }), [
  Ball.of(Flight.at(BALL_START)),
  Kickoff.of({ _tag: 'Never' }),
]);

/** She stands still, sent nowhere. */
export const still: Component.ValueOf<typeof Walk> = { x: 0, y: 0 };

/** A player joins as a baller, standing where the pitch starts, her feet where they stand, sent nowhere. */
export const join = (joined: State.State) =>
  State.spawn(joined, [
    Feet.of(idle),
    Walk.of(still),
    Spot.of({ x: 0, z: 0 }),
    Aim.of(standingAt({ x: 0, z: 0 })),
  ]);
