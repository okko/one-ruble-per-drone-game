import { describe, expect, it } from 'vitest';
import {
  EMBER,
  SMOKE,
  SPARK,
  advanceField,
  advanceRings,
  createField,
  createRings,
  emitBurst,
  emitRing,
  fadeOf,
  liveCount,
  ringFade,
  ringRadius,
  type BurstOptions,
  type ParticleField,
} from './vfx';

const burst = (over: Partial<BurstOptions> = {}): BurstOptions => ({
  x: 1,
  y: 2,
  z: 3,
  count: 8,
  kind: SPARK,
  speed: 4,
  life: 0.5,
  size: 0.2,
  rise: 0,
  ...over,
});

/** Run a field to a standstill, returning how many steps it took. */
function settle(field: ParticleField, dt = 1 / 60): number {
  let steps = 0;
  while (liveCount(field) > 0 && steps < 10000) {
    advanceField(field, dt, 9);
    steps += 1;
  }
  return steps;
}

describe('particle field', () => {
  it('starts empty at the capacity asked for', () => {
    const f = createField(32);
    expect(f.capacity).toBe(32);
    expect(liveCount(f)).toBe(0);
    expect(f.alive.length).toBe(32);
  });

  it('never has a capacity below one, however it is asked', () => {
    expect(createField(0).capacity).toBe(1);
    expect(createField(-5).capacity).toBe(1);
    expect(createField(3.7).capacity).toBe(3);
  });

  it('a burst fills slots at the point it was fired from', () => {
    const f = createField(32);
    expect(emitBurst(f, burst({ count: 5 }))).toBe(5);
    expect(liveCount(f)).toBe(5);
    for (let i = 0; i < 5; i += 1) {
      expect(f.x[i]).toBeCloseTo(1, 4);
      expect(f.y[i]).toBeCloseTo(2, 4);
      expect(f.z[i]).toBeCloseTo(3, 4);
      expect(f.kind[i]).toBe(SPARK);
    }
  });

  it('overwrites the oldest rather than growing when a burst overflows', () => {
    const f = createField(8);
    emitBurst(f, burst({ count: 20 }));
    expect(f.capacity).toBe(8);
    expect(liveCount(f)).toBe(8);
    expect(f.alive.length).toBe(8);
  });

  it('allocates nothing after construction: the slabs are the same objects throughout', () => {
    const f = createField(16);
    const before = [f.x, f.vy, f.life, f.alive];
    emitBurst(f, burst({ count: 40 }));
    advanceField(f, 1 / 60, 9);
    expect([f.x, f.vy, f.life, f.alive]).toEqual(before);
  });

  it('gives every particle a different velocity, so a burst is a burst', () => {
    const f = createField(32);
    emitBurst(f, burst({ count: 12 }));
    const speeds = new Set<number>();
    for (let i = 0; i < 12; i += 1) speeds.add(Math.round((f.vx[i] ?? 0) * 1000));
    expect(speeds.size).toBeGreaterThan(8);
  });

  it('respects the speed it was given', () => {
    const f = createField(64);
    emitBurst(f, burst({ count: 40, speed: 3 }));
    for (let i = 0; i < 40; i += 1) {
      const v = Math.hypot(f.vx[i] ?? 0, f.vy[i] ?? 0, f.vz[i] ?? 0);
      expect(v).toBeLessThanOrEqual(3 * 1.001);
    }
  });

  it('throws debris upward when asked to rise, and evenly when not', () => {
    const flat = createField(64);
    const up = createField(64);
    emitBurst(flat, burst({ count: 40, rise: 0 }));
    emitBurst(up, burst({ count: 40, rise: 1.2 }));
    let flatUp = 0;
    let risenUp = 0;
    for (let i = 0; i < 40; i += 1) {
      if ((flat.vy[i] ?? 0) > 0) flatUp += 1;
      if ((up.vy[i] ?? 0) > 0) risenUp += 1;
    }
    expect(risenUp).toBeGreaterThan(flatUp);
    expect(flatUp).toBeGreaterThan(5);
    expect(flatUp).toBeLessThan(35);
  });

  it('moves particles, then retires them when their life runs out', () => {
    const f = createField(16);
    emitBurst(f, burst({ count: 4, life: 0.2 }));
    const x0 = f.x[0] ?? 0;
    advanceField(f, 1 / 60, 9);
    expect(f.x[0]).not.toBeCloseTo(x0, 6);
    settle(f);
    expect(liveCount(f)).toBe(0);
  });

  it('retires within the life it was given, however long the burst', () => {
    const f = createField(16);
    emitBurst(f, burst({ count: 16, life: 0.3 }));
    // The per-particle jitter tops out at 1.4x the nominal life.
    for (let t = 0; t < 0.3 * 1.4 + 0.02; t += 1 / 240) advanceField(f, 1 / 240, 9);
    expect(liveCount(f)).toBe(0);
  });

  it('pulls sparks down and lifts smoke up', () => {
    const sparks = createField(8);
    const smoke = createField(8);
    emitBurst(sparks, burst({ count: 8, kind: SPARK, speed: 0, life: 2 }));
    emitBurst(smoke, burst({ count: 8, kind: SMOKE, speed: 0, life: 2 }));
    for (let i = 0; i < 30; i += 1) {
      advanceField(sparks, 1 / 60, 9);
      advanceField(smoke, 1 / 60, 9);
    }
    expect(sparks.y[0] ?? 0).toBeLessThan(2);
    expect(smoke.y[0] ?? 0).toBeGreaterThan(2);
  });

  it('lifts smoke gently and drops debris hard: they are not the same force', () => {
    // Smoke is buoyant, not anti-gravity. If it climbed as fast as debris falls, a burst
    // would read as two symmetric sprays rather than as fire under a rising column.
    const sparks = createField(4);
    const smoke = createField(4);
    emitBurst(sparks, burst({ count: 4, kind: SPARK, speed: 0, life: 5 }));
    emitBurst(smoke, burst({ count: 4, kind: SMOKE, speed: 0, life: 5 }));
    for (let i = 0; i < 40; i += 1) {
      advanceField(sparks, 1 / 60, 9);
      advanceField(smoke, 1 / 60, 9);
    }
    const fell = 2 - (sparks.y[0] ?? 0);
    const rose = (smoke.y[0] ?? 0) - 2;
    expect(rose).toBeGreaterThan(0);
    expect(rose).toBeLessThan(fell);
  });

  it('carries every particle along its own velocity, on all three axes', () => {
    // The integration is the whole simulation; everything else is decoration on top of it.
    // Velocity is damped before the position is advanced, so the position after a step is
    // exactly the position before plus the POST-drag velocity — which pins the order too.
    // Six decimals, not more: the slabs are Float32Array and a round trip through one costs
    // about eight significant digits.
    const f = createField(8);
    emitBurst(f, burst({ count: 4, speed: 6, life: 3 }));
    const p0 = [f.x[0] ?? 0, f.y[0] ?? 0, f.z[0] ?? 0] as const;
    const dt = 1 / 90;
    advanceField(f, dt, 9);
    expect(f.x[0] ?? 0).toBeCloseTo(p0[0] + (f.vx[0] ?? 0) * dt, 6);
    expect(f.y[0] ?? 0).toBeCloseTo(p0[1] + (f.vy[0] ?? 0) * dt, 6);
    expect(f.z[0] ?? 0).toBeCloseTo(p0[2] + (f.vz[0] ?? 0) * dt, 6);
  });

  it('drags the horizontal speed down every step', () => {
    const f = createField(16);
    emitBurst(f, burst({ count: 8, speed: 9, life: 3 }));
    const before = Array.from(f.vx).map(Math.abs);
    advanceField(f, 1 / 60, 0);
    for (let i = 0; i < 8; i += 1) {
      const was = before[i] ?? 0;
      if (was < 1e-6) continue; // a particle fired straight up has nothing to slow
      expect(Math.abs(f.vx[i] ?? 0)).toBeLessThan(was);
    }
  });

  it('scatters a burst around the whole circle, not into one quadrant', () => {
    const f = createField(64);
    emitBurst(f, burst({ count: 48, speed: 5, rise: 0 }));
    const quadrants = new Set<number>();
    for (let i = 0; i < 48; i += 1) {
      const vx = f.vx[i] ?? 0;
      const vz = f.vz[i] ?? 0;
      quadrants.add((vx >= 0 ? 1 : 0) + (vz >= 0 ? 2 : 0));
    }
    expect(quadrants.size).toBe(4);
  });

  it('varies particle size around the size it was given, without running away from it', () => {
    const f = createField(64);
    emitBurst(f, burst({ count: 48, size: 2 }));
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 48; i += 1) {
      const s = f.size[i] ?? 0;
      min = Math.min(min, s);
      max = Math.max(max, s);
    }
    expect(min).toBeGreaterThan(2 * 0.5);
    expect(max).toBeLessThan(2 * 1.5);
    expect(max - min).toBeGreaterThan(2 * 0.3);
  });

  it('ignores a zero or backwards step', () => {
    const f = createField(8);
    emitBurst(f, burst({ count: 2 }));
    const snapshot = Array.from(f.x);
    const lives = Array.from(f.life);
    advanceField(f, 0, 9);
    advanceField(f, -1, 9);
    expect(Array.from(f.x)).toEqual(snapshot);
    // A backwards step must not hand a particle its life back, or a paused tab would
    // resume with debris that has been hanging in the air since before it was fired.
    expect(Array.from(f.life)).toEqual(lives);
    expect(liveCount(f)).toBe(2);
  });

  it('emits nothing for a zero or negative count', () => {
    const f = createField(8);
    expect(emitBurst(f, burst({ count: 0 }))).toBe(0);
    expect(emitBurst(f, burst({ count: -3 }))).toBe(0);
    expect(liveCount(f)).toBe(0);
  });

  it('fades from one to zero over a particle\u2019s life, and is zero for a free slot', () => {
    const f = createField(8);
    emitBurst(f, burst({ count: 1, life: 1 }));
    expect(fadeOf(f, 0)).toBeCloseTo(1, 3);
    advanceField(f, (f.maxLife[0] ?? 0) / 2, 9);
    expect(fadeOf(f, 0)).toBeCloseTo(0.5, 3);
    expect(fadeOf(f, 7)).toBe(0);
  });

  it('is deterministic: the same bursts give the same field', () => {
    const a = createField(24);
    const b = createField(24);
    for (const f of [a, b]) {
      emitBurst(f, burst({ count: 9, kind: EMBER }));
      advanceField(f, 1 / 60, 9);
      emitBurst(f, burst({ count: 9 }));
      advanceField(f, 1 / 60, 9);
    }
    expect(Array.from(a.x)).toEqual(Array.from(b.x));
    expect(Array.from(a.vy)).toEqual(Array.from(b.vy));
    expect(a.seed).toBe(b.seed);
  });

  it('does not repeat itself: a second burst differs from the first', () => {
    const f = createField(64);
    emitBurst(f, burst({ count: 8 }));
    const first = Array.from(f.vx.slice(0, 8));
    emitBurst(f, burst({ count: 8 }));
    expect(Array.from(f.vx.slice(8, 16))).not.toEqual(first);
  });
});

describe('shockwave rings', () => {
  it('starts empty and never has a capacity below one', () => {
    expect(createRings(4).capacity).toBe(4);
    expect(createRings(0).capacity).toBe(1);
    expect(ringFade(createRings(4), 0)).toBe(0);
  });

  it('recycles round-robin rather than growing', () => {
    const r = createRings(2);
    for (let i = 0; i < 5; i += 1) emitRing(r, i, 0, 0, 2, 0.3);
    expect(r.alive.length).toBe(2);
    expect(r.alive[0]).toBe(1);
    expect(r.alive[1]).toBe(1);
  });

  it('snaps out and creeps: most of the growth happens early', () => {
    const r = createRings(2);
    emitRing(r, 0, 0, 0, 10, 1);
    advanceRings(r, 0.25);
    const quarter = ringRadius(r, 0);
    advanceRings(r, 0.25);
    const half = ringRadius(r, 0);
    expect(quarter).toBeGreaterThan(10 * 0.25); // faster than linear
    expect(half - quarter).toBeLessThan(quarter);
    expect(half).toBeLessThanOrEqual(10);
  });

  it('fades out and retires', () => {
    const r = createRings(2);
    emitRing(r, 0, 0, 0, 5, 0.4);
    expect(ringFade(r, 0)).toBeCloseTo(1, 3);
    advanceRings(r, 0.2);
    expect(ringFade(r, 0)).toBeCloseTo(0.25, 3);
    advanceRings(r, 0.3);
    expect(ringFade(r, 0)).toBe(0);
    expect(ringRadius(r, 0)).toBe(0);
  });

  it('ignores a zero or backwards step', () => {
    const r = createRings(2);
    emitRing(r, 0, 0, 0, 5, 0.4);
    advanceRings(r, 0);
    advanceRings(r, -1);
    expect(r.life[0]).toBeCloseTo(0.4, 6);
  });
});
