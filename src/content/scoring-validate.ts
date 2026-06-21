/**
 * Validator for the scoring balance table (docs/areas/04-scoring.md §5). Confirms point values are
 * finite ≥ 0, combo thresholds are ascending with multipliers in 1..5, jackpot sequences are
 * non-empty uppercase words, and timings are sane. `comboDecaySeconds` may be Infinity (disabled).
 */
import { ContentValidationError } from './content-error';
import { asArray, asObject, num, str, isFiniteNumber, oneOf } from './validate-helpers';
import type { ScoringBalance } from './scoring';
import type { MultiplierStep } from '../state/game-state';

const STEPS: readonly MultiplierStep[] = [1, 2, 3, 4, 5];

export function validateScoringBalance(raw: unknown): ScoringBalance {
  const path = 'content.scoring';
  const root = asObject(raw, path);

  const bp = asObject(root.basePoints, `${path}.basePoints`);
  if (Object.keys(bp).length === 0) {
    throw new ContentValidationError('basePoints is empty', `${path}.basePoints`);
  }
  for (const [kind, v] of Object.entries(bp)) {
    if (!isFiniteNumber(v) || v < 0) {
      throw new ContentValidationError(`basePoints.${kind} must be a number ≥ 0`, `${path}.basePoints`);
    }
  }

  const thresholds = asArray(root.comboThresholds, `${path}.comboThresholds`);
  if (thresholds.length === 0) {
    throw new ContentValidationError('comboThresholds is empty', `${path}.comboThresholds`);
  }
  let prevCombo = -1;
  thresholds.forEach((tRaw, i) => {
    const tp = `${path}.comboThresholds[${i}]`;
    const t = asObject(tRaw, tp);
    const combo = num(t, 'combo', tp, { int: true, min: 0 });
    if (combo <= prevCombo) throw new ContentValidationError('combo thresholds must ascend', tp);
    prevCombo = combo;
    if (!STEPS.includes(t.mult as MultiplierStep)) {
      throw new ContentValidationError('mult must be 1..5', tp);
    }
  });

  oneOf(root.missResetMode, ['step', 'full'] as const, `${path}.missResetMode`);

  if (typeof root.comboDecaySeconds !== 'number' || root.comboDecaySeconds <= 0) {
    throw new ContentValidationError('comboDecaySeconds must be a positive number (Infinity to disable)', path);
  }

  const seqs = asArray(root.jackpotSequences, `${path}.jackpotSequences`);
  seqs.forEach((sRaw, i) => {
    const sp = `${path}.jackpotSequences[${i}]`;
    const s = asObject(sRaw, sp);
    const word = str(s, 'word', sp);
    if (word !== word.toUpperCase()) throw new ContentValidationError('word must be uppercase', sp);
    num(s, 'baseValue', sp, { min: 1 });
    if (typeof s.escalates !== 'boolean') throw new ContentValidationError('escalates must be a boolean', sp);
    num(s, 'maxMult', sp, { min: 1 });
  });

  const bm = asObject(root.bonusMode, `${path}.bonusMode`);
  num(bm, 'factor', `${path}.bonusMode`, { min: 1 });
  num(bm, 'durationSeconds', `${path}.bonusMode`, { min: 0 });
  num(bm, 'maxFactor', `${path}.bonusMode`, { min: 1 });
  str(bm, 'triggerKind', `${path}.bonusMode`);

  const ss = asObject(root.skillShot, `${path}.skillShot`);
  num(ss, 'windowSeconds', `${path}.skillShot`, { min: 0 });
  num(ss, 'bonus', `${path}.skillShot`, { min: 0 });

  num(root, 'tidyRatePerSecond', path, { min: 0 });

  const surv = asObject(root.incidentSurvivalBonus, `${path}.incidentSurvivalBonus`);
  if (!isFiniteNumber(surv.default)) {
    throw new ContentValidationError('incidentSurvivalBonus.default must be a number', `${path}.incidentSurvivalBonus`);
  }
  for (const [id, v] of Object.entries(surv)) {
    if (!isFiniteNumber(v) || v < 0) {
      throw new ContentValidationError(`incidentSurvivalBonus.${id} must be a number ≥ 0`, `${path}.incidentSurvivalBonus`);
    }
  }

  return raw as ScoringBalance;
}
