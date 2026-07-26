import { describe, it, expect } from 'vitest';
import { ENV_STEPS, envStepFor, FOG_FAR, FOG_NEAR, rigFor, sunDirectionFor } from './lighting';

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

  it('turns the sky toward night as the light falls, in step with the lights', () => {
    expect(rigFor(1).night).toBe(0);
    expect(rigFor(0).night).toBe(1);
    // The one control: sky, stars and fog all read this, so it must be exactly the inverse of day.
    expect(rigFor(0.25).night).toBeCloseTo(0.75, 6);
  });

  it('hazes toward the horizon it is standing under, not toward grey', () => {
    // Fully day: the haze IS the day horizon stop. Fully night: the night one. A fog that stayed a
    // fixed colour would read as a wall at dusk, when the sky behind it has moved and it has not.
    expect(rigFor(1).fogColor.t).toBe(1);
    expect(rigFor(0).fogColor.t).toBe(0);
    expect(rigFor(1).fogColor.to).toBe('skyDayLow');
    expect(rigFor(0).fogColor.from).toBe('skyNightMid');
  });

  it('keeps the action plane clear of haze', () => {
    // The shooting camera is 16 units from the action plane (TOWER_Z + 3 to ACTION_Z). §3.1 says
    // drone-vs-sky contrast survives, so the fog must not start until well past it.
    expect(FOG_NEAR).toBeGreaterThan(16);
    expect(FOG_FAR).toBeGreaterThan(FOG_NEAR);
  });
});

describe('sun travel', () => {
  it('returns a unit vector at every hour', () => {
    for (let c = 0; c < 1; c += 0.02) {
      const d = sunDirectionFor(c);
      expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 6);
    }
  });

  it('never lets the key light set', () => {
    // One light plays both sun and moon. Below the horizon it would stop lighting the world, and a
    // key raking along it would stripe the roof — §3.1, readability first.
    for (let c = 0; c < 1; c += 0.02) {
      expect(sunDirectionFor(c).y).toBeGreaterThan(0.1);
    }
  });

  it('stands highest at midday and lowest at midnight', () => {
    expect(sunDirectionFor(0.5).y).toBeGreaterThan(sunDirectionFor(0.25).y);
    expect(sunDirectionFor(0.25).y).toBeGreaterThan(sunDirectionFor(0).y);
    // Symmetric about noon: the same height going up as coming down.
    expect(sunDirectionFor(0.25).y).toBeCloseTo(sunDirectionFor(0.75).y, 6);
  });

  it('sweeps its bearing right round once per cycle, so shadows travel', () => {
    // Dawn and dusk share an elevation; if the bearing did not differ, the sun would go back the way
    // it came and the shadows would never cross the roof.
    const dawn = sunDirectionFor(0.25);
    const dusk = sunDirectionFor(0.75);
    expect(dawn.x).toBeCloseTo(-dusk.x, 6);
    expect(Math.hypot(dawn.x - dusk.x, dawn.z - dusk.z)).toBeGreaterThan(1);
  });

  it('is periodic, so a long shift never runs out of sky', () => {
    const noon = sunDirectionFor(0.5);
    for (const c of [1.5, 2.5, -0.5, -3.5]) {
      const d = sunDirectionFor(c);
      expect(d.x).toBeCloseTo(noon.x, 6);
      expect(d.y).toBeCloseTo(noon.y, 6);
      expect(d.z).toBeCloseTo(noon.z, 6);
    }
    expect(sunDirectionFor(Number.NaN)).toEqual(sunDirectionFor(0));
  });
});

describe('environment-map stepping', () => {
  it('buckets the whole daylight range without escaping it', () => {
    for (let d = 0; d <= 1.0001; d += 0.01) {
      const step = envStepFor(d);
      expect(step).toBeGreaterThanOrEqual(0);
      expect(step).toBeLessThan(ENV_STEPS);
      expect(Number.isInteger(step)).toBe(true);
    }
    // The top edge is the one that bites: `floor(1 * 16)` is a seventeenth bucket.
    expect(envStepFor(1)).toBe(ENV_STEPS - 1);
    expect(envStepFor(0)).toBe(0);
  });

  it('holds still across a frame, and moves across a shift', () => {
    // The point of quantising: a bake is far too expensive per frame and invisible per frame too.
    expect(envStepFor(0.5)).toBe(envStepFor(0.5 + 1 / ENV_STEPS / 4));
    expect(envStepFor(0.1)).not.toBe(envStepFor(0.9));
  });

  it('clamps out-of-range daylight rather than baking a bucket that does not exist', () => {
    expect(envStepFor(-1)).toBe(0);
    expect(envStepFor(9)).toBe(ENV_STEPS - 1);
    expect(envStepFor(Number.NaN)).toBe(0);
  });
});
