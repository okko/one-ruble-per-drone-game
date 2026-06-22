/**
 * Combat balance table (docs/areas/01-gameplay-engine.md §5/§3.6). DATA, not logic: every spawn,
 * gun, scaling, projectile, and difficulty-ramp constant lives here so `src/systems/combat/*` stays
 * pure and tuning never touches code. The scaling FUNCTIONS (effectiveSpawnInterval, hpScale, …) live
 * in the combat modules and read these coefficients. Validated by `validateCombatBalance`, exposed
 * as `content.combat`. Coordinates are in the fixed 384×216 backing buffer (docs/compatibility.md §2).
 */
import type { Vec2 } from '../core/math';

export interface CombatBalance {
  arena: { width: number; height: number };
  /** Where drones home to (the post). Reaching within `escapeRadius` is an escape. */
  postTarget: Vec2;
  escapeRadius: number;
  postIntegrityMax: number;

  gun: {
    pivot: Vec2;
    turnRate: number; // rad/s the barrel slews toward the effective aim
    fireRate: number; // shots/s while firing
    heatPerShot: number; // 0..100 added per shot
    coolRate: number; // heat/s shed while not firing
    cooloffResume: number; // overheat clears once heat falls below this
    jamClearPerInput: number; // jamClearProgress gained per clear input
    jamClearThreshold: number; // jamClearProgress needed to clear a jam
  };

  aim: {
    swayFrequencyHz: number; // reticle drift speed
    drunkFrequencyHz: number; // slower vodka lurch
    swayRadPerUnit: number; // radians per unit of MeterEffects.aimSway (0..2)
    drunkWobbleRad: number; // lurch amplitude (radians) while drunk
  };

  projectile: {
    speed: number; // px/s
    ttl: number; // seconds before despawn
    radius: number; // collision radius
    cap: number; // max simultaneous projectiles (older ones culled)
    hitscan: boolean; // accessibility/perf fallback; default false (projectiles)
  };

  spawn: {
    baseInterval: number; // seconds between spawns at D=0
    minInterval: number; // floor on the interval at/above dSoftcap
    dSoftcap: number; // D at which the interval reaches minInterval
    jitter: number; // ± fraction of the interval drawn from rng
    baseConcurrent: number; // concurrent-drone cap at D=0
    concurrentPerD: number; // extra cap per unit D
    maxConcurrent: number; // hard cap regardless of D
  };

  scaling: { speedPerD: number; hpPerD: number };

  difficulty: { rampSeconds: number; maxD: number; dayLengthSeconds: number };
}

export const combatBalance: CombatBalance = {
  arena: { width: 384, height: 216 },
  postTarget: { x: 192, y: 196 },
  escapeRadius: 14,
  postIntegrityMax: 100,

  gun: {
    pivot: { x: 192, y: 196 },
    turnRate: 8,
    fireRate: 10,
    heatPerShot: 4,
    coolRate: 32,
    cooloffResume: 40,
    jamClearPerInput: 25,
    jamClearThreshold: 100,
  },

  aim: { swayFrequencyHz: 0.7, drunkFrequencyHz: 0.4, swayRadPerUnit: 0.12, drunkWobbleRad: 0.18 },

  projectile: { speed: 320, ttl: 1.5, radius: 1.5, cap: 64, hitscan: false },

  spawn: {
    baseInterval: 1.6,
    minInterval: 0.45,
    dSoftcap: 10,
    jitter: 0.25,
    baseConcurrent: 4,
    concurrentPerD: 1,
    maxConcurrent: 18,
  },

  scaling: { speedPerD: 0.08, hpPerD: 0.12 },

  difficulty: { rampSeconds: 120, maxD: 12, dayLengthSeconds: 90 },
};
