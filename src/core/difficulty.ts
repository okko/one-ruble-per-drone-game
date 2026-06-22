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

/**
 * Continuous daylight in [0,1] for RENDER ONLY (docs/areas/11-art-visual-style.md §3.5): a cosine
 * over the day+night period peaking at mid-day (≈1), troughing at mid-night (≈0), ~0.5 at dawn/dusk.
 * Derived from `shiftSeconds` so the combat sim's read-only relationship to `time` is unchanged.
 */
export function daylightAt(shiftSeconds: number, ramp: DifficultyRamp): number {
  const period = ramp.dayLengthSeconds * 2;
  const phase = (Math.max(0, shiftSeconds) - ramp.dayLengthSeconds / 2) / period;
  return (Math.cos(phase * 2 * Math.PI) + 1) / 2;
}
