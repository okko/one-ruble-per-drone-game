/**
 * Behavioural / transient types owned by the Gameplay Engine (docs/areas/01-gameplay-engine.md §4).
 * The persistent SLICE types (CombatState, GunState, Drone, Projectile, MovementProfile,
 * SpawnDirectorState) live in `src/state/game-state.ts` to keep that module cycle-free; these are the
 * non-state values that flow between the combat functions and the scene.
 */
import type { Vec2 } from '../../core/math';
import type { SpawnDirectorState } from '../../state/game-state';

/** What `stepSpawns` emits each roll; combat.ts materializes it into a Drone. Deterministic per seed. */
export interface SpawnCommand {
  kind: string;
  origin: Vec2; // offscreen point on a skyline edge
  colorTag?: string; // jackpot letter, if tagged (unused this pass; plumbed for later)
}

/** Incident forced-wave override (the non-null shape of `SpawnDirectorState.override`). */
export type SpawnOverride = NonNullable<SpawnDirectorState['override']>;

/** Aim degradation Meters supplies (derived from `MeterEffects`), applied to effective aim (§3.7). */
export interface AimModifier {
  swayAmplitude: number; // radians
  swayFrequency: number; // Hz
  drunkWobble: number; // radians — larger, slower lurch
  drunkFrequency: number; // Hz of the drunk lurch (internal; spec lists only swayFrequency)
  steadinessPenalty: number; // 0..1, scales turn rate down
}

/** Per-tick player input snapshot the scene buffers and hands to the engine (input-source agnostic). */
export interface PlayerIntent {
  aimTarget: Vec2 | null; // pointer/touch world position, or null when only keyboard is used
  rotateDir: number; // -1 / 0 / +1 keyboard barrel rotation
  fireHeld: boolean; // mouse button / Space / held touch
}

/** A neutral, do-nothing intent (the engine's default when the scene has no input yet). */
export const IDLE_INTENT: PlayerIntent = { aimTarget: null, rotateDir: 0, fireHeld: false };
