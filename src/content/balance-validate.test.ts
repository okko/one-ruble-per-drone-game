import { describe, it, expect } from 'vitest';
import { validateCombatBalance } from './balance-validate';
import { combatBalance } from './balance';
import { ContentValidationError } from './content-error';

describe('validateCombatBalance', () => {
  it('accepts the shipped balance', () => {
    expect(validateCombatBalance(combatBalance)).toBe(combatBalance);
  });

  it('rejects a non-object', () => {
    expect(() => validateCombatBalance(null)).toThrow(ContentValidationError);
  });

  it('rejects minInterval > baseInterval', () => {
    const bad = { ...combatBalance, spawn: { ...combatBalance.spawn, minInterval: 99 } };
    expect(() => validateCombatBalance(bad)).toThrow(/minInterval must be ≤ baseInterval/);
  });

  it('rejects maxConcurrent < baseConcurrent', () => {
    const bad = { ...combatBalance, spawn: { ...combatBalance.spawn, maxConcurrent: 1, baseConcurrent: 4 } };
    expect(() => validateCombatBalance(bad)).toThrow(/maxConcurrent must be ≥ baseConcurrent/);
  });

  it('rejects cooloffResume >= 100 (overheat would never clear)', () => {
    const bad = { ...combatBalance, gun: { ...combatBalance.gun, cooloffResume: 100 } };
    expect(() => validateCombatBalance(bad)).toThrow(/cooloffResume/);
  });

  it('rejects a non-boolean projectile.hitscan', () => {
    const bad = { ...combatBalance, projectile: { ...combatBalance.projectile, hitscan: 'no' } };
    expect(() => validateCombatBalance(bad)).toThrow(/hitscan must be a boolean/);
  });

  it('rejects a malformed postTarget', () => {
    const bad = { ...combatBalance, postTarget: { x: 1 } };
    expect(() => validateCombatBalance(bad)).toThrow(ContentValidationError);
  });

  it('rejects a non-finite scaling coefficient', () => {
    const bad = { ...combatBalance, scaling: { ...combatBalance.scaling, hpPerD: Number.NaN } };
    expect(() => validateCombatBalance(bad)).toThrow(/hpPerD/);
  });
});
