/**
 * Spawn director (docs/areas/01-gameplay-engine.md §3.2). Deterministic and data-driven: an
 * interval/cap model driven by difficulty `D`, a `D`-weighted kind table, and skyline-edge spawn
 * points — all randomness via the injected seeded `rng`. `stepSpawns` is the pure step the tests use:
 * a given `(seed, D, dt sequence)` yields an identical `SpawnCommand[]` stream. Incident flags and the
 * forced-wave override scale the rate and queue the boss.
 */
import { lerp, clamp } from '../../core/math';
import type { Vec2 } from '../../core/math';
import type { Rng } from '../../core/rng';
import type { CombatState, IncidentFlags } from '../../state/game-state';
import type { DroneDef } from '../../content/drones';
import type { CombatBalance } from '../../content/balance';
import type { Content } from '../../content/loader';
import type { SpawnCommand } from './types';

const BOSS_KIND = 'boss';

/** Mean seconds between spawns: shrinks from `baseInterval` to `minInterval` as D → dSoftcap (§3.2). */
export function effectiveSpawnInterval(D: number, balance: CombatBalance): number {
  const t = clamp(D / balance.spawn.dSoftcap, 0, 1);
  return lerp(balance.spawn.baseInterval, balance.spawn.minInterval, t);
}

/** Max simultaneous drones, rising with D up to the hard cap (§3.2/§3.6). */
export function concurrentCap(D: number, balance: CombatBalance): number {
  const cap = Math.floor(balance.spawn.baseConcurrent + balance.spawn.concurrentPerD * D);
  return Math.min(balance.spawn.maxConcurrent, Math.max(balance.spawn.baseConcurrent, cap));
}

/** Drone kinds eligible at difficulty D: unlocked + positively weighted, plus decoys when active. */
export function candidateDefs(D: number, drones: DroneDef[], flags: IncidentFlags): DroneDef[] {
  const out = drones.filter((d) => d.kind !== BOSS_KIND && d.unlockD <= D && d.weightAtD(D) > 0);
  if (flags.decoysActive) {
    const decoy = drones.find((d) => d.kind === 'decoy_bird');
    if (decoy) out.push(decoy);
  }
  return out;
}

/** Weighted kind pick using the seeded rng; decoys get a fixed weight so a flock actually appears. */
function pickKind(rng: Rng, cands: DroneDef[], D: number, flags: IncidentFlags): DroneDef {
  const first = cands[0];
  if (first === undefined) throw new Error('pickKind: no candidates');
  const weightOf = (d: DroneDef): number => (d.kind === 'decoy_bird' && flags.decoysActive ? 2 : d.weightAtD(D));
  let total = 0;
  for (const c of cands) total += weightOf(c);
  if (total <= 0) return first;
  let r = rng.next() * total;
  for (const c of cands) {
    r -= weightOf(c);
    if (r < 0) return c;
  }
  return first;
}

/** A point just offscreen on the top or upper-side skyline edges (§3.2 "from any direction"). */
export function pickSpawnOrigin(rng: Rng, balance: CombatBalance): Vec2 {
  const w = balance.arena.width;
  const h = balance.arena.height;
  const edge = rng.int(0, 3); // 0 = top, 1 = left, 2 = right
  if (edge === 0) return { x: rng.range(0, w), y: -8 };
  if (edge === 1) return { x: -8, y: rng.range(0, h * 0.6) };
  return { x: w + 8, y: rng.range(0, h * 0.6) };
}

/**
 * One spawn step. Decrements the interval timer; on expiry it reschedules (rate scaled by the
 * incident `spawnRateMultiplier` and any forced-wave override) and emits one spawn when under the
 * concurrent cap. A queued/active boss is spawned once, ahead of the regular roll.
 */
export function stepSpawns(
  combat: CombatState,
  dt: number,
  D: number,
  rng: Rng,
  content: Content,
  flags: IncidentFlags,
): SpawnCommand[] {
  const balance = content.combat;
  const dir = combat.director;
  const cap = concurrentCap(D, balance);
  const cmds: SpawnCommand[] = [];

  // Boss: spawn once when an incident wants one and none is alive (slot permitting).
  const bossWanted = (dir.override?.queuedBoss ?? false) || flags.bossActive;
  const bossAlive = combat.drones.some((d) => d.kind === BOSS_KIND);
  if (bossWanted && !bossAlive && combat.drones.length < cap) {
    cmds.push({ kind: BOSS_KIND, origin: pickSpawnOrigin(rng, balance) });
    if (dir.override) dir.override.queuedBoss = false;
  }

  dir.timer -= dt;
  if (dir.timer <= 0) {
    const spawnMul = flags.spawnRateMultiplier * (dir.override?.spawnMultiplier ?? 1);
    const interval = effectiveSpawnInterval(D, balance) / Math.max(spawnMul, 0.0001);
    const jitter = 1 + rng.range(-balance.spawn.jitter, balance.spawn.jitter);
    dir.timer += Math.max(0.05, interval * jitter);

    if (combat.drones.length + cmds.length < cap) {
      const cands = candidateDefs(D, content.drones, flags);
      if (cands.length > 0) {
        const def = pickKind(rng, cands, D, flags);
        cmds.push({ kind: def.kind, origin: pickSpawnOrigin(rng, balance) });
      }
    }
  }
  return cmds;
}
