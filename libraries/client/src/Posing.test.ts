import { describe, expect, it } from '@effect/vitest';
import { type Joint, Pose, Quaternion, Shape } from '@lightocean/core';
import { Effect, Option } from 'effect';
import * as Three from 'three/webgpu';
import * as Posing from '#src/Posing.ts';
import * as Shaping from '#src/Shaping.ts';

/** Degrees, as radians. */
const degrees = (angle: number) => (angle * Math.PI) / 180;

const ACROSS = { x: 1, y: 0, z: 0 };
const ALONG = { x: 0, y: 1, z: 0 };
const AHEAD = { x: 0, y: 0, z: 1 };

/** The name of the knee's corrective shape, which keeps a bent knee's crease. */
const KNEE_FIX = 'fix-calf-flex-120';

/**
 * A leg as a model is delivered, facing +z: a root on the ground, a hip a metre over it, a knee half a metre below the hip, and a foot on the ground, with its skin a point at each and a corrective shape for a bent knee, which the mesh names in its extras, rising from 30° of bend to 120°.
 */
const leg = () => {
  const bone = (name: string, y: number, parent?: Three.Object3D) => {
    const made = new Three.Bone();
    made.name = name;
    made.position.set(0, y, 0);
    parent?.add(made);
    return made;
  };
  const root = bone('root', 0);
  const thigh = bone('thigh', 1, root);
  const calf = bone('calf', -0.5, thigh);
  const foot = bone('foot', -0.5, calf);
  const geometry = new Three.BufferGeometry();
  geometry.setAttribute(
    'position',
    new Three.Float32BufferAttribute([0, 1, 0, 0, 0.5, 0, 0, 0, 0], 3),
  );
  geometry.setAttribute(
    'skinIndex',
    new Three.Uint16BufferAttribute([1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0], 4),
  );
  geometry.setAttribute(
    'skinWeight',
    new Three.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4),
  );
  const crease = new Three.Float32BufferAttribute([0, 0, 0, 0, 0, 0.05, 0, 0, 0], 3);
  crease.name = KNEE_FIX;
  geometry.morphAttributes.position = [crease];
  const mesh = new Three.SkinnedMesh(geometry, new Three.MeshBasicNodeMaterial());
  mesh.name = 'leg';
  mesh.updateMorphTargets();
  mesh.userData = {
    correctives: [{ target: KNEE_FIX, joint: 'calf', axis: 'flex', from: 30, full: 120 }],
  };
  mesh.add(root);
  const model = new Three.Group();
  model.add(mesh);
  mesh.bind(new Three.Skeleton([root, thigh, calf, foot]));
  return model;
};

/** The leg's joints: a hip turning every way, and a knee bending about the line across it. */
const joints: Joint.Joints = {
  thigh: {
    kind: 'Ball',
    axes: { flex: ACROSS, abduct: Option.some(AHEAD), twist: Option.some(ALONG) },
    swing: { flex: [degrees(-20), degrees(120)], abduct: Option.some([degrees(-30), degrees(45)]) },
    twist: Option.some([degrees(-40), degrees(45)]),
    depends: [],
    follows: Option.none(),
    flesh: Option.none(),
  },
  calf: {
    kind: 'Hinge',
    axes: { flex: ACROSS, abduct: Option.none(), twist: Option.some(ALONG) },
    swing: { flex: [degrees(-5), degrees(140)], abduct: Option.none() },
    twist: Option.some([0, 0]),
    depends: [],
    follows: Option.none(),
    flesh: Option.none(),
  },
};

/** The bones of `model` as it stands now, in its own space, as `Shape.Bones` holds a model's bones as made. */
const bonesOf = (model: Three.Object3D): Shape.Bones => {
  model.updateMatrixWorld(true);
  const toModel = model.matrixWorld.clone().invert();
  const bones: Record<string, Shape.Bone> = {};
  model.traverse((child) => {
    if (child instanceof Three.Bone) {
      const at = new Three.Vector3().setFromMatrixPosition(
        child.matrixWorld.clone().premultiply(toModel),
      );
      const { x, y, z, w } = new Three.Quaternion().setFromRotationMatrix(
        child.matrixWorld.clone().premultiply(toModel),
      );
      bones[child.name] = {
        parent: child.parent instanceof Three.Bone ? Option.some(child.parent.name) : Option.none(),
        at: { x: at.x, y: at.y, z: at.z },
        turn: { x, y, z, w },
      };
    }
  });
  return bones;
};

/** Where the bone `name` of `model` stands in the model's own space. */
const drawnAt = (model: Three.Object3D, name: string) => {
  model.updateMatrixWorld(true);
  const bone = model.getObjectByName(name);
  return bone === undefined
    ? new Three.Vector3(Number.NaN)
    : model.worldToLocal(bone.getWorldPosition(new Three.Vector3()));
};

/** How far `drawn` is from `placed`. */
const apart = (drawn: Three.Vector3, placed: Pose.Placed | undefined) =>
  placed === undefined
    ? Infinity
    : drawn.distanceTo(new Three.Vector3(placed.at.x, placed.at.y, placed.at.z));

/** The leg with its hip bent 40° and abducted 10°, its knee bent 90°, standing half a metre ahead, turned a quarter. */
const kicking: Pose.Pose = {
  at: { x: 0, y: 0, z: 0.5 },
  turn: Quaternion.about(ALONG, Math.PI / 2),
  turns: {
    thigh: { flex: degrees(40), abduct: degrees(10), twist: degrees(15) },
    calf: { flex: degrees(90), abduct: 0, twist: 0 },
  },
};

describe('Posing.fit', () => {
  it.effect('refuses a model that has no bone a joint turns, naming each', () =>
    Effect.gen(function* () {
      const ankle = joints['calf'];
      const unfitted = yield* Effect.flip(
        Posing.fit(leg(), ankle === undefined ? joints : { ...joints, ankle, toe: ankle }),
      );

      expect(unfitted.absent).toEqual(['ankle', 'toe']);
    }),
  );
});

describe('Posed.pose', () => {
  it.effect('draws every bone where the pose places it', () =>
    Effect.gen(function* () {
      const model = leg();
      const made = bonesOf(model);
      const posed = yield* Posing.fit(model, joints);

      posed.pose(kicking);

      const placed = Pose.place(made, joints, kicking);
      expect(apart(drawnAt(model, 'calf'), placed['calf'])).toBeLessThan(1e-6);
      expect(apart(drawnAt(model, 'foot'), placed['foot'])).toBeLessThan(1e-6);
    }),
  );

  it.effect('draws a shaped figure where the pose places her as she is shaped', () =>
    Effect.gen(function* () {
      const model = leg();
      const made = bonesOf(model);
      const shape = Shape.make({ shin: Shape.lengthen(['foot'], { by: 0.5 }) });
      const shaped = yield* Shaping.fit(model, shape);
      shaped.shape({ shin: 1 });
      const posed = yield* Posing.fit(shaped, joints);

      posed.pose(kicking);

      const placed = Pose.place(Shape.shaped(shape, made, { shin: 1 }), joints, kicking);
      expect(apart(drawnAt(shaped, 'foot'), placed['foot'])).toBeLessThan(1e-6);
    }),
  );

  it.effect('weighs the knee’s corrective shape by how far the knee bends, whole at 120°', () =>
    Effect.gen(function* () {
      const model = leg();
      const posed = yield* Posing.fit(model, joints);
      const mesh = model.getObjectByName('leg');
      const weightAt = (bent: number) => {
        posed.pose({ ...Pose.rest, turns: { calf: { flex: degrees(bent), abduct: 0, twist: 0 } } });
        return mesh instanceof Three.Mesh ? mesh.morphTargetInfluences?.[0] : undefined;
      };

      expect(weightAt(0)).toBe(0);
      expect(weightAt(75)).toBeCloseTo(0.5, 12);
      expect(weightAt(120)).toBeCloseTo(1, 12);
      expect(weightAt(140)).toBe(1);
    }),
  );

  it.effect(
    'goes over what the model was posed as by a weight, a bone and all below it at once',
    () =>
      Effect.gen(function* () {
        const model = leg();
        const made = bonesOf(model);
        const posed = yield* Posing.fit(model, joints);
        const bentKnee = {
          ...Pose.rest,
          turns: { calf: { flex: degrees(90), abduct: 0, twist: 0 } },
        };

        posed.pose(bentKnee, { calf: 0 });
        const untouched = drawnAt(model, 'foot');
        posed.pose(bentKnee, { calf: 0.5 });
        const halfway = drawnAt(model, 'foot');

        expect(apart(untouched, Pose.place(made, joints, Pose.rest)['foot'])).toBeLessThan(1e-6);
        const half = Pose.place(made, joints, {
          ...Pose.rest,
          turns: { calf: { flex: degrees(45), abduct: 0, twist: 0 } },
        });
        expect(apart(halfway, half['foot'])).toBeLessThan(1e-6);
      }),
  );

  it.effect('goes over the same weight frame after frame to the same pose, never adding up', () =>
    Effect.gen(function* () {
      const model = leg();
      const posed = yield* Posing.fit(model, joints);
      const bentKnee = {
        ...Pose.rest,
        turns: { calf: { flex: degrees(90), abduct: 0, twist: 0 } },
      };

      posed.pose(bentKnee, { calf: 0.5 });
      const once = drawnAt(model, 'foot');
      posed.pose(bentKnee, { calf: 0.5 });
      posed.pose(bentKnee, { calf: 0.5 });

      expect(drawnAt(model, 'foot').distanceTo(once)).toBeLessThan(1e-9);
    }),
  );
});
