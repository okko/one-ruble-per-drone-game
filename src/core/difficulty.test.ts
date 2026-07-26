import { describe, it, expect } from 'vitest';
import { difficultyAt, phaseAt, daylightAt, dayCycleAt } from './difficulty';
import type { DifficultyRamp } from './difficulty';

const ramp: DifficultyRamp = { rampSeconds: 120, maxD: 12, dayLengthSeconds: 90 };

describe('difficultyAt', () => {
  it('is 0 at shift start', () => {
    expect(difficultyAt(0, ramp)).toBe(0);
  });

  it('climbs linearly to the ceiling at rampSeconds', () => {
    expect(difficultyAt(60, ramp)).toBeCloseTo(6, 5);
    expect(difficultyAt(120, ramp)).toBe(12);
  });

  it('clamps at maxD past the ramp and never goes negative', () => {
    expect(difficultyAt(1000, ramp)).toBe(12);
    expect(difficultyAt(-5, ramp)).toBe(0);
  });
});

describe('phaseAt', () => {
  it('starts in day and flips to night after one day length', () => {
    expect(phaseAt(0, ramp)).toBe('day');
    expect(phaseAt(89, ramp)).toBe('day');
    expect(phaseAt(90, ramp)).toBe('night');
  });

  it('alternates each half-cycle', () => {
    expect(phaseAt(180, ramp)).toBe('day');
    expect(phaseAt(270, ramp)).toBe('night');
  });
});

describe('daylightAt', () => {
  it('peaks at mid-day, troughs at mid-night, ~0.5 at dawn/dusk', () => {
    expect(daylightAt(45, ramp)).toBeCloseTo(1, 5); // mid-day
    expect(daylightAt(135, ramp)).toBeCloseTo(0, 5); // mid-night
    expect(daylightAt(0, ramp)).toBeCloseTo(0.5, 5); // dawn
    expect(daylightAt(90, ramp)).toBeCloseTo(0.5, 5); // dusk
  });

  it('stays within [0,1] and is deterministic', () => {
    for (const t of [0, 30, 60, 90, 120, 200, 500]) {
      const v = daylightAt(t, ramp);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(daylightAt(t, ramp)).toBe(v);
    }
  });
});

describe('dayCycleAt', () => {
  it('puts midnight at 0 and midday at 0.5', () => {
    expect(dayCycleAt(45, ramp)).toBeCloseTo(0.5, 6); // mid-day
    expect(dayCycleAt(135, ramp)).toBeCloseTo(0, 6); // mid-night
  });

  it('agrees with daylightAt about when noon is', () => {
    // The two share a clock. If they ever disagreed, the painted sun would rise while the lights set.
    for (let t = 0; t < 360; t += 7) {
      const expected = (1 - Math.cos(dayCycleAt(t, ramp) * 2 * Math.PI)) / 2;
      expect(daylightAt(t, ramp)).toBeCloseTo(expected, 6);
    }
  });

  it('advances in one direction, which is the whole reason it exists', () => {
    // `daylightAt` is a cosine and reads the same at dawn and dusk. This must not.
    expect(dayCycleAt(0, ramp)).not.toBeCloseTo(dayCycleAt(90, ramp), 3);
    let prev = dayCycleAt(1, ramp);
    for (let t = 2; t < 89; t += 1) {
      const v = dayCycleAt(t, ramp);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });

  it('stays in [0,1) and wraps once per full cycle', () => {
    for (const t of [0, 30, 60, 90, 120, 200, 500, 5000]) {
      const v = dayCycleAt(t, ramp);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    // One full day+night is `dayLengthSeconds * 2`.
    expect(dayCycleAt(200, ramp)).toBeCloseTo(dayCycleAt(200 + 180, ramp), 6);
  });

  it('clamps negative time the same way the rest of the ramp does', () => {
    expect(dayCycleAt(-50, ramp)).toBeCloseTo(dayCycleAt(0, ramp), 6);
  });
});
