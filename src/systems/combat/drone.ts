/**
 * Drone simulation (docs/areas/01-gameplay-engine.md §3.3/§3.6). Difficulty scaling, spawn
 * materialization, and the per-tick movement archetypes. Movement is a pure function of a drone's
 * seeded `MovementProfile` + elapsed time, so a given seed reproduces the same paths. Stats come from
 * `content/drones.ts`; scaling coefficients from `content/balance.ts`.
 */
import { v2 } from '../../core/math';
import type { Rng } from '../../core/rng';
import type { Drone, MovementProfile } from '../../state/game-state';
import type { DroneDef } from '../../content/drones';
import type { CombatBalance } from '../../content/balance';

const TWO_PI = Math.PI * 2;

/** Tougher with difficulty: rounds up so hp stays an integer hit-count (§3.6). */
export function hpScale(baseHp: number, D: number, balance: CombatBalance): number {
  return Math.ceil(baseHp * (1 + D * balance.scaling.hpPerD));
}

/** Faster with difficulty (§3.6). */
export function speedScale(baseSpeed: number, D: number, balance: CombatBalance): number {
  return baseSpeed * (1 + D * balance.scaling.speedPerD);
}

/** Build a live drone from a catalog def + spawn origin, scaling stats and seeding movement params. */
export function materialize(
  id: number,
  def: DroneDef,
  origin: { x: number; y: number },
  D: number,
  rng: Rng,
  balance: CombatBalance,
): Drone {
  const speed = speedScale(def.baseSpeed, D, balance);
  const hp = hpScale(def.baseHp, D, balance);
  const movement: MovementProfile = {
    kind: def.movement,
    speed,
    origin: { ...origin },
    target: { ...balance.postTarget },
    amplitude: def.movement === 'zigzag' ? rng.range(10, 24) : def.movement === 'wander' ? rng.range(8, 16) : 0,
    frequency: def.movement === 'zigzag' || def.movement === 'wander' ? rng.range(0.3, 0.8) : 0,
    phase: rng.range(0, TWO_PI),
    accel: def.movement === 'kamikaze' ? rng.range(20, 40) : 0,
    elapsed: 0,
  };
  return {
    id,
    kind: def.kind,
    pos: { ...origin },
    vel: { x: 0, y: 0 },
    hp,
    maxHp: hp,
    radius: def.radius,
    movement,
    escapeDamage: def.escapeDamage,
    awardsRuble: def.awardsRuble,
  };
}

/** Advance a drone one tick: recompute pos from its profile, derive vel as the finite difference. */
export function advanceDrone(drone: Drone, dt: number, balance: CombatBalance): void {
  const m = drone.movement;
  m.elapsed += dt;
  const prev = drone.pos;
  let pos: { x: number; y: number };

  switch (m.kind) {
    case 'straight':
    case 'boss': {
      const dir = v2.norm(v2.sub(m.target, m.origin));
      pos = v2.add(m.origin, v2.scale(dir, m.speed * m.elapsed));
      break;
    }
    case 'kamikaze': {
      const dir = v2.norm(v2.sub(m.target, m.origin));
      const dist = m.speed * m.elapsed + 0.5 * m.accel * m.elapsed * m.elapsed;
      pos = v2.add(m.origin, v2.scale(dir, dist));
      break;
    }
    case 'zigzag': {
      const dir = v2.norm(v2.sub(m.target, m.origin));
      const perp = { x: -dir.y, y: dir.x };
      const base = v2.add(m.origin, v2.scale(dir, m.speed * m.elapsed));
      const lateral = m.amplitude * Math.sin(TWO_PI * m.frequency * m.elapsed + m.phase);
      pos = v2.add(base, v2.scale(perp, lateral));
      break;
    }
    case 'wander': {
      // Never targets the post: drift toward the nearer horizontal edge with a gentle vertical bob.
      const dirX = m.origin.x < balance.arena.width / 2 ? 1 : -1;
      pos = {
        x: m.origin.x + dirX * m.speed * m.elapsed,
        y: m.origin.y + m.amplitude * Math.sin(TWO_PI * m.frequency * m.elapsed + m.phase),
      };
      break;
    }
  }

  drone.vel = dt > 0 ? v2.scale(v2.sub(pos, prev), 1 / dt) : { x: 0, y: 0 };
  drone.pos = pos;
}

/** True when a drone has reached the post (an escape). `wander` decoys never target the post. */
export function reachedTarget(drone: Drone, balance: CombatBalance): boolean {
  if (drone.movement.kind === 'wander') return false;
  return v2.dist(drone.pos, balance.postTarget) <= balance.escapeRadius;
}

/** True when a position has drifted off the arena (used to cull wandering decoys harmlessly). */
export function offArena(pos: { x: number; y: number }, balance: CombatBalance, margin = 24): boolean {
  return (
    pos.x < -margin ||
    pos.x > balance.arena.width + margin ||
    pos.y < -margin ||
    pos.y > balance.arena.height + margin
  );
}
