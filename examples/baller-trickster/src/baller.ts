import {
  Action,
  Ball as Flight,
  Component,
  Domain,
  Game,
  Maths,
  Pose,
  Reach,
  Rule,
  State,
  System,
  Touch,
} from '@lightocean/core';
import { Option, Schema } from 'effect';
import * as Body from '#src/body.ts';

/**
 * The seventh example: a baller doing tricks with a ball, her legs worked by the player, one stick each. A stick places its foot, ahead and back, out and in, and a trigger lifts it; her hip, knee, and ankle turn as a leg turns to put it there, never further than a leg turns. The state holds only where her feet are headed, as they go toward where the sticks place them at a foot's pace: her pose is worked out from that, by reaching, in the step as in the view, so a touch of the ball is the simulation's to decide. Whatever part of her boot or leg touches the ball strikes it, as fast as that part moves and gripping it as that part grips, and the ball flies, spins, bounces, and rolls; the player puts it back before her at a press.
 */

/** How far a stick places its foot from where it stands: ahead or back, and out or in, at a full tilt, and how high a trigger lifts it, in metres. */
export const REACH = { ahead: 0.45, across: 0.3, lift: 0.45 };

/** How fast a foot goes toward where its stick places it, in metres a second. */
export const FOOT_SPEED = 5;

/** Where each foot stands as she stands still, its ankle over the ground. */
export const STANDING = Body.standing;

/** Where the ball is put, at rest before her. */
export const BALL_START = { x: 0, y: Flight.football.radius, z: 0.5 };

const Point = Schema.Struct({ x: Schema.Finite, y: Schema.Finite, z: Schema.Finite });
const Placing = Schema.Struct({ x: Schema.Finite, y: Schema.Finite, lift: Schema.Finite });

/** Where a stick places a foot: across, right as it grows, and ahead, each from −1 to 1, and how far its trigger lifts it, from nothing to a whole. */
export type Placing = typeof Placing.Type;

// COMPONENTS

/** What the player demands of her feet: where each stick places its foot, across, right as it grows, and ahead, each from −1 to 1, and how far its trigger lifts it, from nothing to a whole. */
export const Feet = Component.make('Feet', Schema.Struct({ left: Placing, right: Placing }), {
  owner: 'demand',
  network: 'predicted',
});

/** Where each of her feet is headed now, its ankle, in metres: going toward where the sticks place it, at a foot's pace. Her pose is worked out from it. */
export const Aim = Component.make('Aim', Schema.Struct({ left: Point, right: Point }), {
  owner: 'simulation',
  network: 'server',
});

/** The ball, in flight or at rest. */
export const Ball = Component.make('Ball', Flight.Ball, { owner: 'simulation', network: 'server' });

/** When the player last put the ball back: never, or at a tick, for the step to put it back then. */
export const Kickoff = Component.make(
  'Kickoff',
  Schema.Union([Schema.TaggedStruct('Never', {}), Schema.TaggedStruct('At', { tick: Schema.Int })]),
  { owner: 'rules', network: 'server' },
);

/** Her feet at rest, where they stand. */
export const idle: Component.ValueOf<typeof Feet> = {
  left: { x: 0, y: 0, lift: 0 },
  right: { x: 0, y: 0, lift: 0 },
};

// ACTIONS

/** The player put the ball back before her. */
export const ReplacedBall = Action.make('ReplacedBall', {});

// POSE

/** Where `placing` places a foot standing at `standing`: right as its stick goes right, which is toward her right, ahead as it goes up, and up as its trigger lifts it. */
const placed = (standing: Pose.Pose['at'], placing: Placing) => ({
  x: standing.x - placing.x * REACH.across,
  y: standing.y + Math.min(Math.max(placing.lift, 0), 1) * REACH.lift,
  z: standing.z + placing.y * REACH.ahead,
});

/** Where `feet` place her feet. */
export const targetOf = (feet: Component.ValueOf<typeof Feet>): Component.ValueOf<typeof Aim> => ({
  left: placed(STANDING.left, feet.left),
  right: placed(STANDING.right, feet.right),
});

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

/** Her pose with her feet headed where `aim` says: each leg reaching from its hip to its foot's place, its knee toward ahead of it, within what a leg turns. */
export const poseOf = (aim: Component.ValueOf<typeof Aim>): Pose.Pose => {
  const reach = (pose: Pose.Pose, suffix: string, to: Pose.Pose['at']) =>
    Reach.limb(Body.bones, Body.joints, pose, {
      root: `thigh_${suffix}`,
      end: `foot_${suffix}`,
      to,
      swivel: { x: to.x, y: to.y + 0.4, z: to.z + 1 },
    }).pose;
  return reach(reach(Pose.rest, 'l', aim.left), 'r', aim.right);
};

// RULES

/** A ball put back is put back at this tick, which the step puts at rest before her. */
const replaceBall = Rule.on(ReplacedBall, {
  reads: [],
  writes: [Kickoff],
  emits: [],
  run: (context) => {
    for (const [ball] of context.query(Kickoff)) {
      context.set(ball, Kickoff, { _tag: 'At', tick: context.time.tick });
    }
  },
});

// SYSTEMS

/**
 * Her feet go toward where the sticks place them, at a foot's pace; a ball put back this tick lies at rest before her; whatever part of her touches the ball, swept from her pose before to her pose now, strikes it, as fast as that part moves and gripping it as that part grips; and the ball flies on.
 */
const play = System.make({
  name: 'play',
  reads: [Feet, Kickoff],
  writes: [Aim, Ball],
  emits: [],
  run: (context) => {
    const seconds = context.time.secondsPerStep;
    const moved = context.query(Feet, Aim).map(([baller, feet, aim]) => {
      const target = targetOf(feet);
      const now = {
        left: toward(aim.left, target.left, FOOT_SPEED * seconds),
        right: toward(aim.right, target.right, FOOT_SPEED * seconds),
      };
      context.set(baller, Aim, now);
      return { before: poseOf(aim), now: poseOf(now) };
    });
    for (const [ball, kickoff, flown] of context.query(Kickoff, Ball)) {
      const flying =
        kickoff._tag === 'At' && kickoff.tick === context.time.tick ? Flight.at(BALL_START) : flown;
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
                Flight.struck(Flight.football, now, touched, Body.gripOf(touched.part)),
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

// DOMAIN

export const domain = Domain.make({
  name: 'Baller',
  requires: [],
  components: [Feet, Aim, Ball, Kickoff],
  actions: [ReplacedBall],
  events: [],
  systems: [play],
  rules: [replaceBall],
});

export const game = Game.make({ stepRate: 60, domains: [domain] });

/** The pitch, and its ball, at rest, waiting for her. */
export const [state, ball] = State.spawn(State.empty({ seed: 1 }), [
  Ball.of(Flight.at(BALL_START)),
  Kickoff.of({ _tag: 'Never' }),
]);

/** A player joins as a baller, standing, her feet where they stand. */
export const join = (joined: State.State) => State.spawn(joined, [Feet.of(idle), Aim.of(STANDING)]);
