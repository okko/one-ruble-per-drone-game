/**
 * Scoring balance table (docs/areas/04-scoring.md §5). DATA, not logic: every point value, combo
 * threshold, jackpot sequence, and timing lives here so `src/systems/scoring.ts` stays pure and
 * tuning never touches code. Validated by `validateScoringBalance`, exposed as `content.scoring`.
 */
import type { MultiplierStep } from '../state/game-state';

export interface ScoringBalance {
  basePoints: Record<string, number>; // drone kind -> base points
  comboThresholds: Array<{ combo: number; mult: MultiplierStep }>;
  missResetMode: 'step' | 'full';
  comboDecaySeconds: number; // Infinity to disable
  jackpotSequences: Array<{ word: string; baseValue: number; escalates: boolean; maxMult: number }>;
  bonusMode: { factor: number; durationSeconds: number; maxFactor: number; triggerKind: string };
  skillShot: { windowSeconds: number; bonus: number };
  tidyRatePerSecond: number;
  incidentSurvivalBonus: Record<string, number> & { default: number };
}

export const scoringBalance: ScoringBalance = {
  basePoints: { scout: 100, heavy: 300, kamikaze: 250, frenzy: 50, boss: 2000 },
  comboThresholds: [
    { combo: 0, mult: 1 },
    { combo: 5, mult: 2 },
    { combo: 12, mult: 3 },
    { combo: 22, mult: 4 },
    { combo: 35, mult: 5 },
  ],
  missResetMode: 'step',
  comboDecaySeconds: Infinity, // disabled by default; balance can enable later
  jackpotSequences: [{ word: 'RUBLE', baseValue: 5000, escalates: true, maxMult: 5 }],
  bonusMode: { factor: 5, durationSeconds: 8, maxFactor: 5, triggerKind: 'frenzy' },
  skillShot: { windowSeconds: 1.5, bonus: 500 },
  tidyRatePerSecond: 5,
  incidentSurvivalBonus: { default: 1000, boss_drone: 2500, swarm: 1500 },
};
