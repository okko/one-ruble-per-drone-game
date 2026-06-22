/**
 * Combat update (docs/areas/01-gameplay-engine.md §3.2-§3.8). Orchestrates the gun, spawn director,
 * drone sim, and swept collision over `CombatState`, and emits the cross-area events Scoring/Economy/
 * Audio react to. Pure over the injected `dt`/`ctx`; all randomness via `ctx.rng`. Rubles are NOT
 * granted here — the engine's kind-aware income handler banks them off `droneDestroyed` (the spec's
 * `player.rubles += 1` predates the immutable economy slice).
 */
import type { SystemContext } from '../../core/system-context';
import type { CombatState, IncidentFlags, Drone } from '../../state/game-state';
import type { AimModifier, PlayerIntent } from './types';
import { updateGun } from './gun';
import { stepSpawns, effectiveSpawnInterval } from './director';
import { materialize, advanceDrone, reachedTarget, offArena } from './drone';
import { sweptHit } from './collision';

export { setJam, clearJam } from './gun';

/** Everything the combat tick needs from the rest of GameState, assembled by the engine each tick. */
export interface CombatTickInput {
  D: number; // time.difficulty
  aimMod: AimModifier; // derived from MeterEffects
  flags: IncidentFlags; // incidents.flags (read, never written here)
  intent: PlayerIntent; // buffered player input
  tSeconds: number; // run-elapsed (shiftSeconds), drives deterministic aim sway
  score: number; // current scoring.score, for the gameOver payload
}

/** Fresh combat slice. `swayPhase` is seeded later by the engine from `ctx.rng` at run start. */
export function createCombatState(content: SystemContext['content']): CombatState {
  const B = content.combat;
  const up = -Math.PI / 2; // barrel starts pointing at the sky
  return {
    drones: [],
    projectiles: [],
    gun: {
      pivot: { ...B.gun.pivot },
      angle: up,
      heat: 0,
      overheated: false,
      jammed: false,
      jamClearProgress: 0,
      fireCooldown: 0,
      firing: false,
      swayPhase: 0,
      recentShotRate: 0,
    },
    aim: { desiredAngle: up, effectiveAngle: up },
    postIntegrity: B.postIntegrityMax,
    director: { timer: effectiveSpawnInterval(0, B), override: null },
    nextDroneId: 1,
    nextProjectileId: 1,
    dronesDowned: 0,
    gameOverEmitted: false,
  };
}

/** Incident hook (major drone attack): set/clear the forced-wave override (docs §3.2/§4). */
export function applySpawnOverride(
  combat: CombatState,
  override: { spawnMultiplier: number; queuedBoss: boolean } | null,
): void {
  combat.director.override = override;
}

export function updateCombat(combat: CombatState, dt: number, ctx: SystemContext, input: CombatTickInput): void {
  if (combat.gameOverEmitted) return; // post destroyed: the run is over, stop simulating

  const B = ctx.content.combat;
  const { D, aimMod, flags, intent, tSeconds } = input;

  // 1. Gun: aim, fire, heat/overheat/jam. Spawns projectiles + emits shotFired.
  updateGun(combat, dt, ctx, aimMod, flags, intent, tSeconds);

  // 2. Spawn director → materialize new drones.
  for (const cmd of stepSpawns(combat, dt, D, ctx.rng, ctx.content, flags)) {
    const def = ctx.content.drones.find((d) => d.kind === cmd.kind);
    if (!def) continue;
    const drone = materialize(combat.nextDroneId++, def, cmd.origin, D, ctx.rng, B);
    if (cmd.colorTag !== undefined) drone.colorTag = cmd.colorTag;
    combat.drones.push(drone);
    ctx.events.emit('droneSpawned', { id: drone.id, kind: drone.kind });
  }

  // 3. Advance projectiles (record prev for the swept test) and drones.
  for (const p of combat.projectiles) {
    p.prev = { ...p.pos };
    p.pos = { x: p.pos.x + p.vel.x * dt, y: p.pos.y + p.vel.y * dt };
    p.ttl -= dt;
  }
  for (const d of combat.drones) advanceDrone(d, dt, B);

  // 4. Collision: each projectile hits the first drone its swept segment crosses.
  const deadProjectiles = new Set<number>();
  const destroyed = new Set<number>();
  for (const p of combat.projectiles) {
    for (const d of combat.drones) {
      if (destroyed.has(d.id)) continue;
      if (sweptHit(p.prev, p.pos, d.pos, d.radius, p.radius)) {
        deadProjectiles.add(p.id);
        d.hp -= 1;
        if (d.hp <= 0) {
          destroyed.add(d.id);
          ctx.events.emit('droneDestroyed', {
            id: d.id,
            kind: d.kind,
            byPlayer: true,
            pos: { ...d.pos },
            ...(d.colorTag !== undefined ? { colorTag: d.colorTag } : {}),
          });
          combat.dronesDowned += 1;
        }
        break; // one projectile, one hit
      }
    }
  }

  // 5. Cull spent projectiles (hit, expired, or off-arena).
  combat.projectiles = combat.projectiles.filter(
    (p) => !deadProjectiles.has(p.id) && p.ttl > 0 && !offArena(p.pos, B),
  );

  // 6. Resolve survivors: destroyed → gone; escapes damage Post Integrity; wandered decoys cull.
  const survivors: Drone[] = [];
  for (const d of combat.drones) {
    if (destroyed.has(d.id)) continue;
    if (reachedTarget(d, B)) {
      ctx.events.emit('droneEscaped', { id: d.id, damage: d.escapeDamage });
      combat.postIntegrity = Math.max(0, combat.postIntegrity - d.escapeDamage);
      continue;
    }
    if (d.movement.kind === 'wander' && offArena(d.pos, B)) continue; // decoy flew off, harmless
    survivors.push(d);
  }
  combat.drones = survivors;

  // 7. Gun-side loss condition: Post Integrity 0 ends the run exactly once.
  if (combat.postIntegrity <= 0 && !combat.gameOverEmitted) {
    combat.gameOverEmitted = true;
    ctx.events.emit('gameOver', {
      score: input.score,
      cause: 'post-destroyed',
      shiftSeconds: input.tSeconds,
      dronesDowned: combat.dronesDowned,
    });
  }
}
