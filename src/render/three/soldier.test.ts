import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import {
  BODY_YAW_LIMIT,
  bodyYawFor,
  createSoldier,
  SOLDIER_H,
  soldierPoseFrom,
  targetsFor,
  type SoldierPose,
} from './soldier';
import { ROOF_DECK_TOP_Y, STORY_H } from './mapping';

const ALL_POSES: SoldierPose[] = ['idle', 'fire', 'tired', 'crisis'];

const mood = (over: Partial<Parameters<typeof soldierPoseFrom>[0]> = {}) => ({
  firing: false,
  crisis: false,
  fatigue: 0,
  ...over,
});

function bounds(o: THREE.Object3D): THREE.Box3 {
  o.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(o);
}

describe('scale', () => {
  it('is a human next to his own building, not a giant', () => {
    // One world unit is roughly 3.3 m (32 storeys of STORY_H make the tower), so
    // a man is well under a single unit. The old 2.4-unit capsule was eight
    // metres tall, which is most of why the rooftop never read correctly.
    expect(SOLDIER_H).toBeGreaterThan(STORY_H * 0.4);
    expect(SOLDIER_H).toBeLessThan(STORY_H);
  });

  it('builds a figure of exactly that height, standing on y = 0', () => {
    const s = createSoldier();
    s.update({ dt: 0, aimAngle: -Math.PI / 2, pose: 'idle', time: 0 });
    const b = bounds(s.group);

    // The group's origin is the sole of his boots. This is what lets the view
    // place him with `position.y = ROOF_DECK_TOP_Y` and nothing else.
    expect(b.min.y).toBeCloseTo(0, 6);
    expect(b.max.y).toBeCloseTo(SOLDIER_H, 2);
    expect(s.height).toBe(SOLDIER_H);
    s.dispose();
  });

  it('is narrower than it is tall, like a person', () => {
    const s = createSoldier();
    s.update({ dt: 0, aimAngle: -Math.PI / 2, pose: 'idle', time: 0 });
    const size = bounds(s.group).getSize(new THREE.Vector3());
    expect(size.x).toBeLessThan(size.y);
    expect(size.z).toBeLessThan(size.y);
    s.dispose();
  });
});

describe('placement on the roof', () => {
  it('puts his boots on the roof deck top face when placed there', () => {
    const s = createSoldier();
    s.group.position.y = ROOF_DECK_TOP_Y;
    s.update({ dt: 0, aimAngle: -Math.PI / 2, pose: 'idle', time: 0 });

    expect(bounds(s.group).min.y).toBeCloseTo(ROOF_DECK_TOP_Y, 6);
    s.dispose();
  });

  it('never lifts his boots off the deck, in any pose, at any time', () => {
    const s = createSoldier();
    s.group.position.y = ROOF_DECK_TOP_Y;

    for (const pose of ALL_POSES) {
      for (let i = 0; i < 240; i++) {
        s.update({ dt: 1 / 60, aimAngle: (i / 240) * Math.PI * 2, pose, time: i / 60 });
        // Poses may sink him (a crouch) but must never float him.
        expect(bounds(s.group).min.y).toBeLessThanOrEqual(ROOF_DECK_TOP_Y + 1e-9);
      }
    }
    s.dispose();
  });
});

describe('bodyYawFor', () => {
  it('never exceeds the clamp, for any aim angle', () => {
    // The point of the clamp: whatever the barrel does, the soldier cannot
    // inherit it. This is the regression that made him spin with the gun.
    for (let a = -8; a <= 8; a += 0.05) {
      expect(Math.abs(bodyYawFor(a))).toBeLessThanOrEqual(BODY_YAW_LIMIT + 1e-12);
    }
  });

  it('faces straight ahead when the aim is vertical', () => {
    expect(bodyYawFor(-Math.PI / 2)).toBeCloseTo(0, 12);
    expect(bodyYawFor(Math.PI / 2)).toBeCloseTo(0, 12);
  });

  it('turns opposite ways for opposite horizontal aims', () => {
    const right = bodyYawFor(0);
    const left = bodyYawFor(Math.PI);
    expect(Math.sign(right)).toBe(-Math.sign(left));
    expect(Math.abs(right)).toBeCloseTo(BODY_YAW_LIMIT, 12);
  });

  it('turns further as the aim swings further off vertical', () => {
    const near = Math.abs(bodyYawFor(-Math.PI / 2 + 0.2));
    const far = Math.abs(bodyYawFor(-Math.PI / 2 + 0.9));
    expect(far).toBeGreaterThan(near);
  });
});

describe('soldierPoseFrom', () => {
  it('fires above everything else — it is what he is doing', () => {
    expect(soldierPoseFrom(mood({ firing: true, crisis: true, fatigue: 1 }))).toBe('fire');
  });

  it('shows a crisis before it shows fatigue', () => {
    expect(soldierPoseFrom(mood({ crisis: true, fatigue: 1 }))).toBe('crisis');
  });

  it('slumps once he is worn down', () => {
    expect(soldierPoseFrom(mood({ fatigue: 0.6 }))).toBe('tired');
    expect(soldierPoseFrom(mood({ fatigue: 0.59 }))).toBe('idle');
  });

  it('stands idle when nothing is wrong', () => {
    expect(soldierPoseFrom(mood())).toBe('idle');
  });
});

describe('targetsFor', () => {
  it('gives every pose a distinct, finite shape', () => {
    const seen = new Set<string>();
    for (const pose of ALL_POSES) {
      const t = targetsFor(pose);
      for (const n of [t.torsoPitch, t.headPitch, t.crouch, t.sway]) {
        expect(Number.isFinite(n)).toBe(true);
      }
      seen.add(JSON.stringify(t));
    }
    expect(seen.size).toBe(ALL_POSES.length);
  });

  it('only ever sinks him', () => {
    for (const pose of ALL_POSES) expect(targetsFor(pose).crouch).toBeGreaterThanOrEqual(0);
  });

  it('leans him into the gun hardest when firing, and slumps him lowest when spent', () => {
    expect(targetsFor('fire').torsoPitch).toBeGreaterThan(targetsFor('idle').torsoPitch);
    expect(targetsFor('tired').crouch).toBeGreaterThan(targetsFor('idle').crouch);
    expect(targetsFor('crisis').crouch).toBeGreaterThan(targetsFor('idle').crouch);
  });

  it('keeps him steadiest when firing', () => {
    for (const pose of ALL_POSES) {
      if (pose === 'fire') continue;
      expect(targetsFor('fire').sway).toBeLessThan(targetsFor(pose).sway);
    }
  });
});

describe('update', () => {
  it('eases toward a new pose rather than snapping', () => {
    const s = createSoldier();
    s.update({ dt: 0, aimAngle: -Math.PI / 2, pose: 'idle', time: 0 });
    const start = bounds(s.group).max.y;

    s.update({ dt: 1 / 60, aimAngle: -Math.PI / 2, pose: 'tired', time: 0 });
    const oneFrame = bounds(s.group).max.y;

    for (let i = 0; i < 300; i++) {
      s.update({ dt: 1 / 60, aimAngle: -Math.PI / 2, pose: 'tired', time: 0 });
    }
    const settled = bounds(s.group).max.y;

    // A slump lowers his crown. One frame gets part of the way there, not all.
    expect(settled).toBeLessThan(start);
    expect(oneFrame).toBeGreaterThan(settled);
    expect(oneFrame).toBeLessThan(start);
    s.dispose();
  });

  it('tracks the aim without ever spinning with the barrel', () => {
    const s = createSoldier();
    const yaws: number[] = [];
    for (let i = 0; i < 600; i++) {
      // Sweep the barrel through several full turns.
      s.update({ dt: 1 / 60, aimAngle: (i / 600) * Math.PI * 6, pose: 'idle', time: i / 60 });
      const body = s.group.children[0];
      if (body) yaws.push(body.rotation.y);
    }
    expect(yaws.length).toBe(600);
    for (const y of yaws) expect(Math.abs(y)).toBeLessThanOrEqual(BODY_YAW_LIMIT + 1e-9);
    s.dispose();
  });

  it('does not move on a zero-length frame', () => {
    const s = createSoldier();
    s.update({ dt: 0, aimAngle: 0, pose: 'fire', time: 0 });
    const body = s.group.children[0];
    expect(body?.rotation.y).toBe(0);
    s.dispose();
  });

  it('disposes its geometries and materials', () => {
    const s = createSoldier();
    let disposed = 0;
    s.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const g = o.geometry;
        const orig = g.dispose.bind(g);
        g.dispose = () => {
          disposed++;
          orig();
        };
      }
    });
    s.dispose();
    expect(disposed).toBeGreaterThan(0);
  });
});
