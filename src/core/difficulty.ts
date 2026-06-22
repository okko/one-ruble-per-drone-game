/**
 * Difficulty / day-night ramp over the shift (docs/areas/01-gameplay-engine.md §3.6). Pure functions
 * of elapsed `shiftSeconds`: the Gameplay-Engine orchestrator calls these once per tick and writes the
 * result into `GameState.time`, so combat stays a read-only consumer of `time.difficulty`/`time.phase`
 * (the spec invariant: the engine never *computes* D inside the combat sim). The ramp config is passed
 * in (structurally `content.combat.difficulty`) so this module imports nothing from `content`.
 */
import { clamp } from './math';

export interface DifficultyRamp {
  rampSeconds: number; // seconds to climb from 0 to maxD
  maxD: number; // difficulty ceiling
  dayLengthSeconds: number; // length of each day (and each night) half-cycle
}

/** Linear climb from 0 at shift start to `maxD` at `rampSeconds`, then held at the ceiling. */
export function difficultyAt(shiftSeconds: number, ramp: DifficultyRamp): number {
  return ramp.maxD * clamp(shiftSeconds / ramp.rampSeconds, 0, 1);
}

/** Day for the first `dayLengthSeconds`, then alternating night/day each half-cycle. */
export function phaseAt(shiftSeconds: number, ramp: DifficultyRamp): 'day' | 'night' {
  const halfCycle = Math.floor(Math.max(0, shiftSeconds) / ramp.dayLengthSeconds);
  return halfCycle % 2 === 0 ? 'day' : 'night';
}
