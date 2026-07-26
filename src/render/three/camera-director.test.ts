import { describe, expect, it } from 'vitest';

import {
  blendPose,
  createCameraDirector,
  damping,
  poseFor,
  type CameraPose,
  type CameraState,
  type PoseContext,
} from './camera-director';
import { floorCentreY, ROOF_Y } from './mapping';

const ALL_STATES: CameraState[] = ['menu', 'intro', 'shooting', 'interior', 'pause'];

const ctx = (over: Partial<PoseContext> = {}): PoseContext => ({
  floor: 24,
  time: 0,
  ...over,
});

function dist(a: CameraPose, b: CameraPose): number {
  return Math.hypot(a.eye.x - b.eye.x, a.eye.y - b.eye.y, a.eye.z - b.eye.z);
}

describe('poseFor', () => {
  it('returns a usable pose for every camera state', () => {
    for (const state of ALL_STATES) {
      const pose = poseFor(state, ctx());
      for (const n of [pose.eye.x, pose.eye.y, pose.eye.z, pose.look.x, pose.look.y, pose.look.z]) {
        expect(Number.isFinite(n)).toBe(true);
      }
      expect(pose.fov).toBeGreaterThan(0);
      expect(pose.fov).toBeLessThan(180);
      // A camera sitting exactly on its own target has no orientation.
      expect(pose.eye).not.toEqual(pose.look);
    }
  });

  it('is pure — the same inputs give the same pose', () => {
    for (const state of ALL_STATES) {
      expect(poseFor(state, ctx({ time: 3 }))).toEqual(poseFor(state, ctx({ time: 3 })));
    }
  });

  it('frames the shooting pose above the roof, looking away from the camera', () => {
    const pose = poseFor('shooting', ctx());
    expect(pose.eye.y).toBeGreaterThan(ROOF_Y);
    // Looking into the scene (−z), i.e. out over the skyline where drones come from.
    expect(pose.look.z).toBeLessThan(pose.eye.z);
  });

  it('starts the intro low and ends the crane high at the post', () => {
    const intro = poseFor('intro', ctx());
    const shooting = poseFor('shooting', ctx());
    expect(intro.eye.y).toBeLessThan(shooting.eye.y);
    expect(intro.eye.y).toBeLessThan(ROOF_Y);
  });

  it('tracks the visited floor in interior mode', () => {
    const low = poseFor('interior', ctx({ floor: 21 }));
    const high = poseFor('interior', ctx({ floor: 32 }));
    expect(low.look.y).toBeCloseTo(floorCentreY(21), 9);
    expect(high.look.y).toBeCloseTo(floorCentreY(32), 9);
    expect(high.eye.y).toBeGreaterThan(low.eye.y);
  });

  it('orbits the tower over time in the menu', () => {
    const a = poseFor('menu', ctx({ time: 0 }));
    const b = poseFor('menu', ctx({ time: 12 }));
    expect(dist(a, b)).toBeGreaterThan(1);
    // It orbits: the look target is fixed and the height does not drift.
    expect(b.look).toEqual(a.look);
    expect(b.eye.y).toBeCloseTo(a.eye.y, 9);
  });

  it('pulls back from the post when paused', () => {
    const shooting = poseFor('shooting', ctx());
    const paused = poseFor('pause', ctx());
    expect(paused.eye.y).toBeGreaterThan(shooting.eye.y);
    expect(paused.eye.z).toBeGreaterThan(shooting.eye.z);
  });
});

describe('blendPose', () => {
  const a = poseFor('shooting', ctx());
  const b = poseFor('interior', ctx());

  it('returns the endpoints exactly', () => {
    expect(blendPose(a, b, 0)).toEqual(a);
    expect(blendPose(a, b, 1)).toEqual(b);
  });

  it('returns the midpoint at t = 0.5', () => {
    const mid = blendPose(a, b, 0.5);
    expect(mid.eye.y).toBeCloseTo((a.eye.y + b.eye.y) / 2, 9);
    expect(mid.look.z).toBeCloseTo((a.look.z + b.look.z) / 2, 9);
    expect(mid.fov).toBeCloseTo((a.fov + b.fov) / 2, 9);
  });

  it('moves monotonically from a to b', () => {
    let prev = 0;
    for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      const d = dist(a, blendPose(a, b, t));
      expect(d).toBeGreaterThan(prev);
      prev = d;
    }
  });
});

describe('damping', () => {
  it('is zero for a zero or negative timestep', () => {
    expect(damping(5, 0)).toBe(0);
    expect(damping(5, -0.1)).toBe(0);
  });

  it('stays inside (0, 1] and grows with the timestep', () => {
    expect(damping(5, 0.016)).toBeGreaterThan(0);
    expect(damping(5, 0.016)).toBeLessThan(1);
    expect(damping(5, 0.5)).toBeGreaterThan(damping(5, 0.1));
    // A long stall must not overshoot the target.
    expect(damping(5, 10)).toBeLessThanOrEqual(1);
  });

  it('is frame-rate independent', () => {
    // Two half-steps must land in the same place as one whole step. A raw
    // `rate * dt` lerp fails this, which is why the exponential form is used.
    const rate = 6;
    const whole = 1 / 30;

    const oneStep = 0 + (1 - 0) * damping(rate, whole);

    let two = 0;
    for (let i = 0; i < 2; i++) two += (1 - two) * damping(rate, whole / 2);

    expect(two).toBeCloseTo(oneStep, 12);
  });
});

describe('createCameraDirector', () => {
  it('starts at the resting pose of its initial state', () => {
    const d = createCameraDirector('menu', ctx());
    expect(d.state).toBe('menu');
    expect(d.pose).toEqual(poseFor('menu', ctx()));
  });

  it('eases toward the new state instead of snapping', () => {
    const d = createCameraDirector('shooting', ctx());
    const from = d.pose;
    const to = poseFor('interior', ctx());

    d.setState('interior');
    d.update(1 / 60, ctx());

    expect(d.pose).not.toEqual(from);
    expect(d.pose).not.toEqual(to);
    // And it moved the right way.
    expect(dist(d.pose, to)).toBeLessThan(dist(from, to));
  });

  it('converges on the target pose when given time', () => {
    const d = createCameraDirector('shooting', ctx());
    d.setState('interior');
    for (let i = 0; i < 600; i++) d.update(1 / 60, ctx());

    expect(dist(d.pose, poseFor('interior', ctx()))).toBeLessThan(0.01);
  });

  it('cuts immediately when asked to', () => {
    const d = createCameraDirector('shooting', ctx());
    d.setState('pause', { immediate: true });
    expect(d.pose).toEqual(poseFor('pause', ctx()));
  });

  it('reports the state it was last asked for', () => {
    const d = createCameraDirector('menu', ctx());
    for (const state of ALL_STATES) {
      d.setState(state);
      expect(d.state).toBe(state);
    }
  });

  it('keeps aimPose fixed at the shooting pose through every state change', () => {
    // The sharpest risk in the whole presentation layer: if framing and aiming
    // are ever coupled, opening a menu silently moves where shots land.
    const d = createCameraDirector('shooting', ctx());
    const expected = poseFor('shooting', ctx());

    expect(d.aimPose).toEqual(expected);

    for (const state of ['menu', 'interior', 'pause', 'intro', 'shooting'] as CameraState[]) {
      d.setState(state);
      for (let i = 0; i < 30; i++) d.update(1 / 60, ctx({ floor: 27, time: i / 60 }));
      expect(d.aimPose).toEqual(expected);
    }
  });

  it('keeps aimPose fixed after an immediate cut', () => {
    const d = createCameraDirector('shooting', ctx());
    d.setState('interior', { immediate: true });
    expect(d.aimPose).toEqual(poseFor('shooting', ctx()));
  });

  it('does not move on a zero-length frame', () => {
    const d = createCameraDirector('shooting', ctx());
    const before = d.pose;
    d.setState('interior');
    d.update(0, ctx());
    expect(d.pose).toEqual(before);
  });

  it('reaches the same place regardless of frame rate', () => {
    const fast = createCameraDirector('shooting', ctx());
    const slow = createCameraDirector('shooting', ctx());
    fast.setState('interior');
    slow.setState('interior');

    for (let i = 0; i < 120; i++) fast.update(1 / 120, ctx());
    for (let i = 0; i < 60; i++) slow.update(1 / 60, ctx());

    expect(fast.pose.eye.y).toBeCloseTo(slow.pose.eye.y, 6);
    expect(fast.pose.eye.z).toBeCloseTo(slow.pose.eye.z, 6);
    expect(fast.pose.fov).toBeCloseTo(slow.pose.fov, 6);
  });
});
