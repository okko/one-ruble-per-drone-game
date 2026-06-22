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
import type { Vec2 } from '../core/math';

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

// ---- Area 01: Gameplay Engine ---------------------------------------------------------------
// Slice + sub-types refined by the Gameplay Engine. Drones/projectiles are plain arrays (the spec §4
// interface), not the ECS registry, so `CombatState` stays a serializable POJO for the golden. The
// drone catalog (`content/drones.ts`) and combat balance (`content/balance.ts`) import `MovementKind`
// from here, mirroring how `content/scoring.ts` imports `MultiplierStep`.
export type MovementKind = 'straight' | 'zigzag' | 'kamikaze' | 'wander' | 'boss';

/** Per-drone movement parameters; pos/vel are pure functions of these + `elapsed` (§3.3). */
export interface MovementProfile {
  kind: MovementKind;
  speed: number; // px/s, already scaled by difficulty at spawn
  origin: Vec2; // spawn position
  target: Vec2; // homing destination (the post); `wander` ignores it
  amplitude: number; // zigzag lateral swing (px)
  frequency: number; // zigzag / wander oscillation (Hz)
  phase: number; // seeded phase offset (rad)
  accel: number; // kamikaze acceleration (px/s^2)
  elapsed: number; // seconds since spawn
}

export interface Drone {
  id: number;
  kind: string; // key into content/drones (and scoring basePoints)
  pos: Vec2;
  vel: Vec2;
  hp: number;
  maxHp: number;
  radius: number;
  movement: MovementProfile;
  escapeDamage: number;
  awardsRuble: boolean; // false for decoy_bird
  colorTag?: string; // jackpot letter, if the director tagged this drone
}

export interface Projectile {
  id: number;
  pos: Vec2;
  prev: Vec2; // previous-tick position, for swept collision (no tunneling)
  vel: Vec2;
  ttl: number; // seconds remaining before despawn
  radius: number;
}

export interface GunState {
  pivot: Vec2;
  angle: number; // current barrel angle (rad)
  heat: number; // 0..100
  overheated: boolean; // locked until heat falls below cooloffResume
  jammed: boolean;
  jamClearProgress: number; // accumulates toward the clear threshold
  fireCooldown: number; // seconds until the next shot is allowed
  firing: boolean;
  swayPhase: number; // per-run aim-sway phase, seeded once at run start
  recentShotRate: number; // 0..1 EWMA of firing; read by Meters via MetersRead (not on MetersState)
}

export interface SpawnDirectorState {
  timer: number; // seconds until the next spawn roll
  /** Incident forced-wave override (set/cleared by `applySpawnOverride`). */
  override: { spawnMultiplier: number; queuedBoss: boolean } | null;
}

export interface CombatState {
  drones: Drone[];
  projectiles: Projectile[];
  gun: GunState;
  aim: { desiredAngle: number; effectiveAngle: number };
  postIntegrity: number; // 0..100, starts at max
  director: SpawnDirectorState;
  nextDroneId: number;
  nextProjectileId: number;
  dronesDowned: number; // run stat (feeds MetersRead + gameOver payload)
  gameOverEmitted: boolean; // post-destroyed guard (combat-local; the engine adds a run-level latch)
}

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
