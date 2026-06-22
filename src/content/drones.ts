/**
 * Drone catalog (docs/areas/01-gameplay-engine.md §3.3/§5). DATA, not logic: the spawn director and
 * drone simulation in `src/systems/combat/*` read these defs and never hard-code drone stats.
 *
 * `kind` is the canonical key and MUST be a key in `scoringBalance.basePoints` for the kill to score
 * (`src/systems/scoring.ts` reads `basePoints[kind] ?? 0`) — `decoy_bird` is the one deliberate
 * exception (0 points, no ruble). `spriteId` decouples the kind from the shipped art id
 * (`drone.scout` etc.). The spec roster names (slow_tank/darter/…) are design flavor realized through
 * `movement`. Base hp/speed are at D=0 and scaled up per difficulty at spawn time.
 */
import type { SpriteId } from './sprite-ids';
import type { MovementKind } from '../state/game-state';

export interface DroneDef {
  kind: string; // canonical key; must be a scoring basePoints key (except decoy_bird)
  spriteId: SpriteId;
  baseHp: number; // at D=0; hpScale(D) rounds up from here
  baseSpeed: number; // px/s at D=0
  radius: number; // collision radius
  escapeDamage: number; // Post Integrity damage if it reaches the post
  awardsRuble: boolean; // false for decoy_bird
  movement: MovementKind;
  unlockD: number; // min difficulty before the director may pick this kind
  weightAtD: (D: number) => number; // relative selection weight (0 ⇒ never picked by the weight table)
}

export const DRONES: DroneDef[] = [
  {
    kind: 'scout', // fast straight dash; the bread-and-butter target
    spriteId: 'drone.scout',
    baseHp: 1,
    baseSpeed: 72,
    radius: 5,
    escapeDamage: 8,
    awardsRuble: true,
    movement: 'straight',
    unlockD: 0,
    weightAtD: () => 3,
  },
  {
    kind: 'heavy', // slow bullet-sponge; big and easy to hit but soaks fire
    spriteId: 'drone.armored',
    baseHp: 5,
    baseSpeed: 28,
    radius: 8,
    escapeDamage: 18,
    awardsRuble: true,
    movement: 'straight',
    unlockD: 0,
    weightAtD: () => 1.5,
  },
  {
    kind: 'kamikaze', // accelerating dive; punishing escape damage
    spriteId: 'drone.bomber',
    baseHp: 2,
    baseSpeed: 38,
    radius: 5,
    escapeDamage: 26,
    awardsRuble: true,
    movement: 'kamikaze',
    unlockD: 3,
    weightAtD: (D) => Math.max(0, D - 3) * 0.5,
  },
  {
    kind: 'frenzy', // fast weaver; killing it triggers Scoring bonus mode (scoring triggerKind)
    spriteId: 'drone.special',
    baseHp: 1,
    baseSpeed: 64,
    radius: 4,
    escapeDamage: 4,
    awardsRuble: true,
    movement: 'zigzag',
    unlockD: 5,
    weightAtD: (D) => (D >= 5 ? 0.6 : 0),
  },
  {
    kind: 'decoy_bird', // never targets the post; shooting it is penalized (Scoring/Incidents).
    spriteId: 'decoy.bird', // Spawned only while the bird-flock incident sets `decoysActive`.
    baseHp: 1,
    baseSpeed: 34,
    radius: 4,
    escapeDamage: 0,
    awardsRuble: false,
    movement: 'wander',
    unlockD: 0,
    weightAtD: () => 0,
  },
  {
    kind: 'boss', // very high HP, slow; only via the "major drone attack" incident override.
    spriteId: 'drone.boss',
    baseHp: 40,
    baseSpeed: 16,
    radius: 14,
    escapeDamage: 50,
    awardsRuble: true,
    movement: 'boss',
    unlockD: 0,
    weightAtD: () => 0,
  },
];
