import { describe, it, expect } from 'vitest';
import { validateDrones } from './drones-validate';
import { DRONES } from './drones';
import { ContentValidationError } from './content-error';

describe('validateDrones', () => {
  it('accepts the shipped catalog', () => {
    expect(validateDrones(DRONES)).toBe(DRONES);
  });

  it('rejects an empty catalog', () => {
    expect(() => validateDrones([])).toThrow(/empty/);
  });

  it('rejects a duplicate kind', () => {
    const bad = [DRONES[0], DRONES[0]];
    expect(() => validateDrones(bad)).toThrow(/duplicate drone kind/);
  });

  it('rejects an unknown spriteId', () => {
    // Use a non-namespace string so the sprite-id usage scan doesn't flag this fixture.
    const bad = [{ ...DRONES[0], spriteId: 'totally-bogus' }];
    expect(() => validateDrones(bad)).toThrow(/unknown spriteId/);
  });

  it('rejects an illegal movement archetype', () => {
    const bad = [{ ...DRONES[0], movement: 'teleport' }];
    expect(() => validateDrones(bad)).toThrow(ContentValidationError);
  });

  it('rejects baseHp < 1', () => {
    const bad = [{ ...DRONES[0], baseHp: 0 }];
    expect(() => validateDrones(bad)).toThrow(/baseHp/);
  });

  it('rejects a non-function weightAtD', () => {
    const bad = [{ ...DRONES[0], weightAtD: 3 }];
    expect(() => validateDrones(bad)).toThrow(/weightAtD must be a function/);
  });

  it('rejects a negative weight', () => {
    const bad = [{ ...DRONES[0], weightAtD: () => -1 }];
    expect(() => validateDrones(bad)).toThrow(/weightAtD\(0\)/);
  });
});
