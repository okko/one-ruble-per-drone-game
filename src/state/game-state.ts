/**
 * The shared GameState skeleton (docs/architecture.md §4). LEAD-OWNED: each gameplay area refines
 * ONLY its own slice. Phase 2 (Meters/Economy/Scoring/Incidents) refines four of the slices here,
 * plus the slice sub-types other areas READ (e.g. `IncidentFlags`, `MultiplierStep`). Behavioural
 * types (`MeterEffects`, `ReliefKind`, `ServiceDef`, `IncidentDef`, …) live in the owning
 * `src/systems/` / `src/content/` modules. To keep this file CYCLE-FREE it imports only `type`s and
 * NOTHING from `src/systems/` — systems import these slice types, never the reverse.
 *
 * `CombatState` remains an area-01 (Gameplay Engine) placeholder; Phase 2 does not touch it. Meters
 * reads `recentShotRate` through an explicit read-view (see `src/systems/meters.ts`), not the slice.
 */
import type { RngState } from '../core/rng';
import type { MeterKey } from '../types/meter-key';

// ---- Area 02: Meters ------------------------------------------------------------------------
export interface MetersState {
  values: Record<MeterKey, number>; // 0..100 (0 = safe, 100 = crisis)
  inCrisis: Record<MeterKey, boolean>;
  crisisTimer: Record<MeterKey, number>; // seconds in crisis (0 if not)
  compoundTimer: number; // seconds with >= 2 active crises
  coffeeTimer: number; // seconds remaining
  drunkTimer: number; // seconds remaining
}

// ---- Area 03: Economy & Residents -----------------------------------------------------------
export interface EconomyState {
  rubles: number; // spendable, >= 0
  debt: number; // owed, >= 0 (rubles & debt never both > 0)
  reputation: number; // global, 0..100
  relationships: Record<string, number>; // per-resident, 0..100
  priceMultiplier: number; // set by incidents (default 1.0)
  disabledServiceTags: string[]; // e.g. ['delivery'] (broken elevator), ['toilet'] (pipe)
  activeChore: { residentId: string; secondsLeft: number } | null;
}

// ---- Area 04: Scoring -----------------------------------------------------------------------
export type MultiplierStep = 1 | 2 | 3 | 4 | 5;

export interface ScoringState {
  score: number; // the highscore metric
  comboCount: number; // consecutive player kills without a miss
  multiplier: MultiplierStep; // derived from comboCount via table
  comboDecayTimer: number; // seconds since last kill (for optional decay)
  litSequence: string[]; // jackpot letters lit so far, e.g. ['R','U']
  jackpotCompletions: number; // for escalating jackpots
  bonusModeFactor: number; // 1 normally, N during frenzy
  bonusModeTimer: number; // seconds remaining of current bonus mode
  skillShotWindow: number; // seconds remaining in open window, 0 if closed
  tidyAccumulator: number; // fractional tidy points pending flush
  tidyFlushTimer: number; // seconds since the last tidy flush (throttles emission to ~1/s)
  activeIncidentId: string | null;
}

// ---- Area 05: Random Incidents --------------------------------------------------------------
// The documented four-phase lifecycle contract (docs/areas/05 §3.2/§4). The current scheduler runs
// `telegraph` → `active` and finalizes synchronously on expiry/resolution (it never parks an
// incident in `resolving`/`cleanup`); those two are reserved for the contract and a future Engine
// that may need an observable wind-down window. See docs/phase-2-implementation.md (deviations).
export type IncidentPhase = 'telegraph' | 'active' | 'resolving' | 'cleanup';
export type IncidentCategory =
  | 'plumbing'
  | 'combat'
  | 'power'
  | 'service'
  | 'social'
  | 'authority'
  | 'nature';

export interface ActiveIncident {
  id: string; // catalog id
  phase: IncidentPhase;
  phaseRemaining: number; // seconds left in current phase
  resolvable: boolean;
}

/** READ-ONLY flags/modifiers other areas consume; recomputed each tick from a frozen baseline. */
export interface IncidentFlags {
  toiletBlocked: boolean; // Meters: block 💩 relief
  spawnRateMultiplier: number; // Gameplay Engine: multiply drone spawn rate (default 1)
  bossActive: boolean; // Gameplay Engine
  gunJammed: boolean; // Gameplay Engine: barrel jam until cleared
  blackout: number; // Render: 0..1 darkness (default 0)
  sleepGainMultiplier: number; // Meters: multiply sleep-deprivation gain (default 1)
  servicePriceMultiplier: number; // Economy: multiply service prices (default 1)
  servicesDisabled: boolean; // Economy: elevator broken → services unavailable
  inputLocked: boolean; // Gameplay Engine/Input: ignore aim/fire input
  decoysActive: boolean; // Gameplay Engine/Scoring: bird flock; shooting birds penalized
}

export interface IncidentsState {
  active: ActiveIncident[];
  nextIn: number; // seconds until next scheduler roll
  cooldowns: Record<string, number>; // per-incident cooldown remaining
  globalCooldown: number;
  flags: IncidentFlags;
}

// ---- Area 01: Gameplay Engine (placeholder — refined later) ---------------------------------
export type CombatState = Record<string, never>; // refined by area 01 (Gameplay Engine)

export interface GameState {
  time: { shiftSeconds: number; phase: 'day' | 'night'; difficulty: number };
  player: { rubles: number; debt: number; reputation: number };
  meters: MetersState;
  combat: CombatState;
  scoring: ScoringState;
  economy: EconomyState;
  incidents: IncidentsState;
  rng: RngState;
  flags: Record<string, boolean>;
}
