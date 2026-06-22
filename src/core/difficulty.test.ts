import { describe, it, expect } from 'vitest';
import { difficultyAt, phaseAt, daylightAt } from './difficulty';
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
