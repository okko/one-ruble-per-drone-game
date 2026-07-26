import { describe, it, expect } from 'vitest';
import { rigFor } from './lighting';

describe('the day/night light rig', () => {
  it('opens the stop as the day brightens, and never slams it shut', () => {
    expect(rigFor(1).exposure).toBeGreaterThan(rigFor(0).exposure);
    // Night is stopped down, not blacked out — the shift is still playable at midnight.
    expect(rigFor(0).exposure).toBeGreaterThan(0.5);
  });

  it('rises monotonically in every light intensity', () => {
    let prevHemi = -Infinity;
    let prevKey = -Infinity;
    let prevExposure = -Infinity;
    for (let d = 0; d <= 1.0001; d += 0.05) {
      const r = rigFor(d);
      expect(r.hemisphere).toBeGreaterThan(prevHemi);
      expect(r.key).toBeGreaterThan(prevKey);
      expect(r.exposure).toBeGreaterThan(prevExposure);
      prevHemi = r.hemisphere;
      prevKey = r.key;
      prevExposure = r.exposure;
    }
  });

  it('never turns a light fully off, so the world is never unlit', () => {
    for (const d of [0, 0.25, 0.5, 0.75, 1]) {
      const r = rigFor(d);
      expect(r.hemisphere).toBeGreaterThan(0);
      expect(r.key).toBeGreaterThan(0);
    }
  });

  it('makes the windows carry the night', () => {
    expect(rigFor(0).windowGlow).toBeGreaterThan(rigFor(1).windowGlow);
    expect(rigFor(1).windowGlow).toBeGreaterThan(0);
  });

  it('walks the key light from moonlight through golden hour to noon', () => {
    expect(rigFor(0).keyColor).toEqual({ from: 'moonlight', to: 'sunLow', t: 0 });
    // Halfway is exactly the low sun, from either side of the seam.
    expect(rigFor(0.499).keyColor.to).toBe('sunLow');
    expect(rigFor(0.499).keyColor.t).toBeCloseTo(1, 2);
    expect(rigFor(0.5).keyColor).toEqual({ from: 'sunLow', to: 'sunNoon', t: 0 });
    expect(rigFor(1).keyColor).toEqual({ from: 'sunLow', to: 'sunNoon', t: 1 });
  });

  it('keeps every ramp position inside [0,1] so a mix is never extrapolated', () => {
    for (let d = 0; d <= 1.0001; d += 0.01) {
      const t = rigFor(d).keyColor.t;
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(1);
    }
  });

  it('reports the sun elevation the shadow direction follows', () => {
    expect(rigFor(0).sunElevation).toBe(0);
    expect(rigFor(1).sunElevation).toBe(1);
    expect(rigFor(0.3).sunElevation).toBeCloseTo(0.3, 6);
  });

  it('clamps a daylight value that escapes its documented range', () => {
    expect(rigFor(-5)).toEqual(rigFor(0));
    expect(rigFor(5)).toEqual(rigFor(1));
    expect(rigFor(Number.NaN)).toEqual(rigFor(0));
  });
});
