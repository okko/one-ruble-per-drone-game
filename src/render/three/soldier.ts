/**
 * The soldier — the conscript the whole game is about, standing on his own roof.
 *
 * He is built here rather than in `view.ts` because he carries hard requirements
 * that are easy to break by accident (docs/areas/11-art-visual-style.md §3.4):
 *
 *  1. His boots rest on the roof deck's TOP FACE, derived from the deck's own
 *     geometry. The group's origin is the sole of his boots, so placing him is
 *     `group.position.y = ROOF_DECK_TOP_Y` — nothing to get wrong.
 *  2. He is NOT parented to the gun. He stands beside it and his torso yaws
 *     toward the aim, damped and clamped, so he tracks the barrel without
 *     inheriting its full swing.
 *  3. He is a recognisable human figure — boots, legs, greatcoat, arms on the
 *     grips, head, ushanka — not an abstract capsule.
 *  4. He is posed by what is happening to him: idle, firing, exhausted, in crisis.
 *  5. In interior mode he walks the building; he is never simply switched off.
 *
 * **Scale.** The tower is 32 storeys of `STORY_H = 0.95`, so one world unit is
 * roughly 3.3 m. A 1.9 m man is therefore ~0.58 units, NOT the 2.4-unit capsule
 * that used to stand here — that figure was eight metres tall, which is most of
 * why the rooftop never read correctly. Every dimension below is a fraction of
 * `SOLDIER_H`, so re-scaling him is a one-line change.
 *
 * The mesh building uses three.js but no renderer, so this module runs — and is
 * tested — headlessly.
 */
import * as THREE from 'three';

import { WORLD } from './theme';
import type { WorldColorKey } from './theme';

/** Total height of the figure, boots to the crown of the ushanka, in world units. */
export const SOLDIER_H = 0.58;

/**
 * How far the torso may twist to follow the aim, in radians. He is braced behind
 * a mounted gun, not pirouetting: the barrel sweeps far further than he does.
 */
export const BODY_YAW_LIMIT = 0.5;

/** How fast the body settles onto a new yaw / pose, in units of 1/second. */
const YAW_RATE = 7;
const POSE_RATE = 5;

export type SoldierPose = 'idle' | 'fire' | 'tired' | 'crisis';

/** What the soldier is going through, as far as his body is concerned. */
export interface SoldierMood {
  /** The gun is actually putting rounds out. */
  readonly firing: boolean;
  /** A meter has bottomed out or an incident is on him. */
  readonly crisis: boolean;
  /** 0 = fresh, 1 = wrecked. Drives the slump. */
  readonly fatigue: number;
}

/** Which pose the body should adopt. Firing wins: it is the thing he is doing. */
export function soldierPoseFrom(mood: SoldierMood): SoldierPose {
  if (mood.firing) return 'fire';
  if (mood.crisis) return 'crisis';
  if (mood.fatigue >= 0.6) return 'tired';
  return 'idle';
}

/** The joint angles and offsets a pose asks for. All fractions of `SOLDIER_H` or radians. */
export interface SoldierPoseTargets {
  /** Forward lean of the upper body about the hips. Positive leans into the gun. */
  readonly torsoPitch: number;
  /** Head tilt relative to the torso. Positive looks down. */
  readonly headPitch: number;
  /** How far the hips drop, as a fraction of the figure's height. */
  readonly crouch: number;
  /** Idle sway amplitude, as a fraction of the figure's height. */
  readonly sway: number;
}

export function targetsFor(pose: SoldierPose): SoldierPoseTargets {
  switch (pose) {
    case 'idle':
      // Upright behind the gun, breathing.
      return { torsoPitch: 0.06, headPitch: 0.02, crouch: 0.0, sway: 0.012 };
    case 'fire':
      // Braced into the recoil: leaning in, head down on the sights, knees bent.
      return { torsoPitch: 0.3, headPitch: 0.12, crouch: 0.05, sway: 0.004 };
    case 'tired':
      // Hanging off the grips. Shoulders forward, head down, sagging.
      return { torsoPitch: 0.34, headPitch: 0.3, crouch: 0.09, sway: 0.02 };
    case 'crisis':
      // Hunched and rigid — a man being shouted at by his own body.
      return { torsoPitch: 0.22, headPitch: -0.12, crouch: 0.11, sway: 0.03 };
  }
}

/**
 * Torso yaw for an arena aim angle, clamped to `BODY_YAW_LIMIT`.
 *
 * The sim's aim angle θ maps to the world direction `(cos θ, −sin θ)` — arena y
 * points down. `cos θ` is therefore the horizontal component of the aim, and the
 * body turns with it. Because the result is a scaled cosine it can never leave
 * ±`BODY_YAW_LIMIT`, which is what stops the figure from ever spinning with the
 * barrel however the aim maths is retuned.
 */
export function bodyYawFor(aimAngle: number): number {
  // The figure is modelled facing −z (out toward the drones), so a positive
  // three.js y-rotation turns him toward −x. Negate to turn him toward the aim.
  return -Math.cos(aimAngle) * BODY_YAW_LIMIT;
}

function damp(rate: number, dt: number): number {
  if (dt <= 0) return 0;
  return 1 - Math.exp(-rate * dt);
}

function mat(key: WorldColorKey): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: new THREE.Color(WORLD[key]), flatShading: true });
}

function box(w: number, h: number, d: number, m: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
}

export interface SoldierUpdate {
  readonly dt: number;
  /** Arena aim angle, radians. */
  readonly aimAngle: number;
  readonly pose: SoldierPose;
  /** Seconds, for the idle sway. */
  readonly time: number;
}

export interface Soldier {
  /** Add this to the scene — NOT to the gun. Origin is the sole of his boots. */
  readonly group: THREE.Group;
  /** Total height, so callers can frame him without re-deriving it. */
  readonly height: number;
  update(u: SoldierUpdate): void;
  dispose(): void;
}

export function createSoldier(): Soldier {
  const H = SOLDIER_H;

  // Vertical layout, bottom-up, as fractions of H. These sum to 1 at the crown.
  const bootH = 0.09 * H;
  const legH = 0.35 * H;
  const coatH = 0.36 * H;
  const headH = 0.14 * H;
  const hatH = 0.06 * H;

  const hipY = bootH + legH; // where the upper body pivots
  const shoulderY = coatH * 0.86; // relative to the hips

  const width = 0.34 * H; // shoulder width
  const depth = 0.2 * H;

  const bootMat = mat('ink');
  const legMat = mat('uniformDk');
  const coatMat = mat('uniform');
  const beltMat = mat('gunmetalDk');
  const skinMat = mat('skin');
  const hatMat = mat('uniformDk');
  const furMat = mat('smoke');

  const group = new THREE.Group();

  // `body` carries the yaw and the crouch; the legs live under it so he turns as
  // one piece rather than twisting off his own feet.
  const body = new THREE.Group();
  group.add(body);

  for (const sx of [-1, 1]) {
    const boot = box(width * 0.36, bootH, depth * 1.3, bootMat);
    boot.position.set(sx * width * 0.24, bootH / 2, depth * 0.1);
    body.add(boot);

    const leg = box(width * 0.3, legH, depth * 0.7, legMat);
    leg.position.set(sx * width * 0.24, bootH + legH / 2, 0);
    body.add(leg);
  }

  // Upper body: pivots at the hips so a forward lean reads as a lean, not a slide.
  const torso = new THREE.Group();
  torso.position.y = hipY;
  body.add(torso);

  // The greatcoat: wider at the hem than at the shoulders. This flare is what
  // makes the silhouette read as a coated soldier rather than a box.
  const coat = new THREE.Mesh(
    new THREE.CylinderGeometry(width * 0.5, width * 0.62, coatH, 8),
    coatMat,
  );
  coat.scale.z = 0.68; // flatten front-to-back into a body, not a barrel
  coat.position.y = coatH / 2;
  torso.add(coat);

  const belt = new THREE.Mesh(
    new THREE.CylinderGeometry(width * 0.56, width * 0.56, coatH * 0.09, 8),
    beltMat,
  );
  belt.scale.z = 0.68;
  belt.position.y = coatH * 0.42;
  torso.add(belt);

  // Arms reaching forward onto the gun's grips. Modelled as one angled box each,
  // so both hands sit where the spade grips are.
  for (const sx of [-1, 1]) {
    const arm = box(width * 0.24, coatH * 0.72, depth * 0.5, coatMat);
    arm.geometry.translate(0, -coatH * 0.36, 0); // pivot at the shoulder
    arm.position.set(sx * width * 0.5, shoulderY, 0);
    arm.rotation.x = -0.95; // down and forward, toward the grips
    torso.add(arm);
  }

  // Head + ushanka.
  const head = new THREE.Group();
  head.position.y = shoulderY + headH * 0.35;
  torso.add(head);

  const skull = box(headH * 0.78, headH, headH * 0.8, skinMat);
  skull.position.y = headH / 2;
  head.add(skull);

  const hat = new THREE.Mesh(
    new THREE.CylinderGeometry(headH * 0.5, headH * 0.5, hatH, 8),
    hatMat,
  );
  hat.position.y = headH + hatH / 2;
  head.add(hat);

  // Fur band + the down earflaps — the bit that makes it unmistakably an ushanka.
  const fur = new THREE.Mesh(new THREE.CylinderGeometry(headH * 0.56, headH * 0.56, hatH * 0.6, 8), furMat);
  fur.position.y = headH + hatH * 0.15;
  head.add(fur);
  for (const sx of [-1, 1]) {
    const flap = box(headH * 0.18, headH * 0.62, headH * 0.5, furMat);
    flap.position.set(sx * headH * 0.46, headH * 0.66, 0);
    head.add(flap);
  }

  // ---- Animation state ------------------------------------------------------
  let yaw = 0;
  let torsoPitch = 0;
  let headPitch = 0;
  let crouch = 0;
  let sway = 0;

  return {
    group,
    height: H,

    update(u: SoldierUpdate): void {
      const t = targetsFor(u.pose);

      const ky = damp(YAW_RATE, u.dt);
      yaw += (bodyYawFor(u.aimAngle) - yaw) * ky;

      const kp = damp(POSE_RATE, u.dt);
      torsoPitch += (t.torsoPitch - torsoPitch) * kp;
      headPitch += (t.headPitch - headPitch) * kp;
      crouch += (t.crouch - crouch) * kp;
      sway += (t.sway - sway) * kp;

      // Breathing / shifting his weight. Deliberately one-sided: it dips between
      // 0 and −sway, so it settles his weight into the deck and can never lift
      // his boots off it. A man standing on a roof does not bob upward.
      const breath = -(0.5 + 0.5 * Math.sin(u.time * 1.7)) * sway * H;

      body.rotation.y = yaw;
      body.position.y = -crouch * H + breath;      torso.rotation.x = torsoPitch;
      head.rotation.x = headPitch - torsoPitch * 0.5; // he keeps his eyes up
    },

    dispose(): void {
      group.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          const m = o.material;
          if (Array.isArray(m)) m.forEach((x) => x.dispose());
          else m.dispose();
        }
      });
    },
  };
}
