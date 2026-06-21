import { describe, it, expect } from 'vitest';
import { validateScoringBalance } from './scoring-validate';
import { scoringBalance } from './scoring';
import { ContentValidationError } from './content-error';

describe('validateScoringBalance', () => {
  it('accepts the shipped balance (including Infinity combo decay)', () => {
    expect(validateScoringBalance(scoringBalance)).toBe(scoringBalance);
  });

  it('rejects a non-object', () => {
    expect(() => validateScoringBalance(null)).toThrow(ContentValidationError);
  });

  it('rejects empty basePoints', () => {
    expect(() => validateScoringBalance({ ...scoringBalance, basePoints: {} })).toThrow(/basePoints is empty/);
  });

  it('rejects a negative base point value', () => {
    expect(() => validateScoringBalance({ ...scoringBalance, basePoints: { scout: -1 } })).toThrow(/basePoints/);
  });

  it('rejects non-ascending combo thresholds', () => {
    const bad = { ...scoringBalance, comboThresholds: [{ combo: 5, mult: 2 }, { combo: 5, mult: 3 }] };
    expect(() => validateScoringBalance(bad)).toThrow(/ascend/);
  });

  it('rejects a multiplier outside 1..5', () => {
    const bad = { ...scoringBalance, comboThresholds: [{ combo: 0, mult: 9 }] };
    expect(() => validateScoringBalance(bad)).toThrow(/mult must be 1..5/);
  });

  it('rejects a non-uppercase jackpot word', () => {
    const bad = { ...scoringBalance, jackpotSequences: [{ word: 'ruble', baseValue: 1, escalates: false, maxMult: 1 }] };
    expect(() => validateScoringBalance(bad)).toThrow(/uppercase/);
  });

  it('rejects a non-positive comboDecaySeconds', () => {
    expect(() => validateScoringBalance({ ...scoringBalance, comboDecaySeconds: 0 })).toThrow(/comboDecaySeconds/);
  });

  it('rejects an invalid missResetMode', () => {
    expect(() => validateScoringBalance({ ...scoringBalance, missResetMode: 'soft' })).toThrow(ContentValidationError);
  });

  it('rejects a missing incidentSurvivalBonus default', () => {
    const bad = { ...scoringBalance, incidentSurvivalBonus: { swarm: 100 } };
    expect(() => validateScoringBalance(bad)).toThrow(/default/);
  });
});
