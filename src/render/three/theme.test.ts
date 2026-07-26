import { describe, it, expect } from 'vitest';
import { WORLD } from './theme';

describe('the world colour theme', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(WORLD)).toBe(true);
  });

  it('every value is a lowercase 6-digit hex color', () => {
    for (const [key, value] of Object.entries(WORLD)) {
      expect(value, `${key} should be #rrggbb`).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('uses at most 32 unique hex values (the §3.2 budget)', () => {
    const unique = new Set(Object.values(WORLD));
    expect(unique.size).toBeLessThanOrEqual(32);
  });

  it('exposes the semantic keys other areas depend on', () => {
    // A representative sample across groups; the registry is the contract.
    for (const key of ['ink', 'skyDayTop', 'meterCrit', 'rubleGold', 'panel'] as const) {
      expect(WORLD[key]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
