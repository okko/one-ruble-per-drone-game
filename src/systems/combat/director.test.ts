import { describe, it, expect } from 'vitest';
import { createRng } from '../../core/rng';
import { createTestContent } from '../../test-support/content';
import { combatBalance } from '../../content/balance';
import { DEFAULT_FLAGS } from '../incidents';
import type { IncidentFlags } from '../../state/game-state';
import { createCombatState } from './combat';
import { stepSpawns, effectiveSpawnInterval, concurrentCap, candidateDefs } from './director';
import type { SpawnCommand } from './types';

function flags(over: Partial<IncidentFlags> = {}): IncidentFlags {
  return { ...DEFAULT_FLAGS, ...over };
}

/** Drive the pure spawn step over a dt sequence; drones are never materialized so the cap never bites. */
function runSpawns(seed: number, D: number, seconds: number, over: Partial<IncidentFlags> = {}, dt = 0.1): SpawnCommand[] {
  const content = createTestContent();
  const rng = createRng(seed);
  const combat = createCombatState(content);
  const f = flags(over);
  const out: SpawnCommand[] = [];
  for (let t = 0; t < seconds; t += dt) out.push(...stepSpawns(combat, dt, D, rng, content, f));
  return out;
}

describe('director: scaling helpers (§8.2)', () => {
  it('effectiveSpawnInterval shrinks from base toward min as D rises', () => {
    expect(effectiveSpawnInterval(0, combatBalance)).toBe(combatBalance.spawn.baseInterval);
    expect(effectiveSpawnInterval(combatBalance.spawn.dSoftcap, combatBalance)).toBeCloseTo(combatBalance.spawn.minInterval, 9);
    expect(effectiveSpawnInterval(5, combatBalance)).toBeLessThan(combatBalance.spawn.baseInterval);
  });

  it('concurrentCap rises with D up to the hard cap', () => {
    expect(concurrentCap(12, combatBalance)).toBeGreaterThan(concurrentCap(0, combatBalance));
    expect(concurrentCap(9999, combatBalance)).toBe(combatBalance.spawn.maxConcurrent);
  });

  it('candidateDefs unlocks harder kinds with D and admits decoys only when active', () => {
    const content = createTestContent();
    const low = candidateDefs(0, content.drones, flags()).map((d) => d.kind);
    const high = candidateDefs(12, content.drones, flags()).map((d) => d.kind);
    expect(low).not.toContain('kamikaze');
    expect(high).toContain('kamikaze');
    expect(low).not.toContain('decoy_bird');
    expect(candidateDefs(0, content.drones, flags({ decoysActive: true })).map((d) => d.kind)).toContain('decoy_bird');
  });
});

describe('director: spawn stream (§8.1, §8.2)', () => {
  it('determinism: same seed + D + dt sequence ⇒ identical SpawnCommand[]', () => {
    expect(runSpawns(42, 5, 60)).toEqual(runSpawns(42, 5, 60));
  });

  it('different seeds produce different streams', () => {
    expect(runSpawns(1, 5, 60)).not.toEqual(runSpawns(2, 5, 60));
  });

  it('higher D yields more spawns and a mix shifted toward harder kinds', () => {
    const low = runSpawns(7, 0, 60);
    const high = runSpawns(7, 12, 60);
    expect(high.length).toBeGreaterThan(low.length);
    expect(new Set(low.map((c) => c.kind)).has('kamikaze')).toBe(false);
    expect(new Set(high.map((c) => c.kind)).has('kamikaze')).toBe(true);
  });

  it('an incident spawn-rate multiplier increases the spawn count', () => {
    const normal = runSpawns(9, 4, 60);
    const swarmed = runSpawns(9, 4, 60, { spawnRateMultiplier: 3 });
    expect(swarmed.length).toBeGreaterThan(normal.length);
  });
});
