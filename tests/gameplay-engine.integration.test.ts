/**
 * Phase 3 cross-area integration (docs/areas/01-gameplay-engine.md §8). Drives the real Gameplay
 * Engine over a full GameState + event bus and proves the seams the unit tests mock: a kill banks a
 * ruble (Economy) AND scores (Scoring) over the bus; a decoy banks nothing; an escape damages Post
 * Integrity; Post Integrity 0 ends the run exactly once (latched against the meters path); and the
 * incident forced-wave hook spawns a boss. Also guards drone-kind ↔ scoring-key drift.
 */
import { describe, it, expect } from 'vitest';
import { createTestContext } from '../src/test-support/context';
import { createGameState } from '../src/state/create-game-state';
import { createEngine } from '../src/systems/combat/engine';
import { applySpawnOverride } from '../src/systems/combat/combat';
import { DRONES } from '../src/content/drones';
import { scoringBalance } from '../src/content/scoring';
import type { SystemContext } from '../src/core/system-context';
import type { CombatState, Drone } from '../src/state/game-state';
import type { PlayerIntent } from '../src/systems/combat/types';

const HOLD_FIRE: PlayerIntent = { aimTarget: null, rotateDir: 0, fireHeld: true };
const NO_FIRE: PlayerIntent = { aimTarget: null, rotateDir: 0, fireHeld: false };

function capture<T>(ctx: SystemContext, key: Parameters<SystemContext['events']['on']>[0]): T[] {
  const out: T[] = [];
  ctx.events.on(key, (p) => out.push(p as T));
  return out;
}

/** Inject a stationary drone (speed 0) at a fixed point so a controlled run can resolve it. */
function injectDrone(combat: CombatState, pos: { x: number; y: number }, opts: { kind?: string; hp?: number; awardsRuble?: boolean; escapeDamage?: number } = {}): Drone {
  const d: Drone = {
    id: combat.nextDroneId++,
    kind: opts.kind ?? 'scout',
    pos: { ...pos },
    vel: { x: 0, y: 0 },
    hp: opts.hp ?? 1,
    maxHp: opts.hp ?? 1,
    radius: 6,
    movement: { kind: 'straight', speed: 0, origin: { ...pos }, target: { x: pos.x, y: pos.y + 400 }, amplitude: 0, frequency: 0, phase: 0, accel: 0, elapsed: 0 },
    escapeDamage: opts.escapeDamage ?? 10,
    awardsRuble: opts.awardsRuble ?? true,
  };
  combat.drones.push(d);
  return d;
}

describe('gameplay engine integration', () => {
  it('a player kill banks a ruble (Economy) and scores (Scoring) over the bus (§8.4)', () => {
    const ctx = createTestContext({ seed: 1 });
    const gs = createGameState(ctx.content, 1);
    const engine = createEngine(gs, ctx);
    gs.combat.director.timer = 9999; // suppress random spawns
    injectDrone(gs.combat, { x: gs.combat.gun.pivot.x, y: gs.combat.gun.pivot.y - 80 }, { kind: 'scout' });

    for (let i = 0; i < 90 && gs.combat.dronesDowned === 0; i++) engine.step(1 / 60, HOLD_FIRE);

    expect(gs.combat.dronesDowned).toBe(1);
    expect(gs.economy.rubles).toBe(1);
    expect(gs.scoring.comboCount).toBe(1);
    expect(gs.scoring.score).toBeGreaterThan(0);
  });

  it('a player-shot decoy banks no ruble (§8.5)', () => {
    const ctx = createTestContext({ seed: 2 });
    const gs = createGameState(ctx.content, 2);
    const engine = createEngine(gs, ctx);
    gs.combat.director.timer = 9999;
    injectDrone(gs.combat, { x: gs.combat.gun.pivot.x, y: gs.combat.gun.pivot.y - 80 }, { kind: 'decoy_bird', awardsRuble: false });

    for (let i = 0; i < 90 && gs.combat.dronesDowned === 0; i++) engine.step(1 / 60, HOLD_FIRE);

    expect(gs.combat.dronesDowned).toBe(1);
    expect(gs.economy.rubles).toBe(0);
  });

  it('an escape damages Post Integrity (§8.6)', () => {
    const ctx = createTestContext({ seed: 3 });
    const gs = createGameState(ctx.content, 3);
    const engine = createEngine(gs, ctx);
    gs.combat.director.timer = 9999;
    injectDrone(gs.combat, { ...ctx.content.combat.postTarget }, { escapeDamage: 18 });

    engine.step(1 / 60, NO_FIRE);

    expect(gs.combat.postIntegrity).toBe(ctx.content.combat.postIntegrityMax - 18);
  });

  it('Post Integrity 0 ends the run exactly once and latches (§8.7)', () => {
    const ctx = createTestContext({ seed: 4 });
    const gs = createGameState(ctx.content, 4);
    const engine = createEngine(gs, ctx);
    const go = capture<{ cause: string }>(ctx, 'gameOver');
    gs.combat.director.timer = 9999;
    gs.combat.postIntegrity = 10;
    injectDrone(gs.combat, { ...ctx.content.combat.postTarget }, { escapeDamage: 50 });

    engine.step(1 / 60, NO_FIRE);
    expect(go).toHaveLength(1);
    expect(go[0]).toMatchObject({ cause: 'post-destroyed' });

    const tBefore = gs.time.shiftSeconds;
    engine.step(1 / 60, NO_FIRE);
    expect(go).toHaveLength(1); // not emitted twice
    expect(gs.time.shiftSeconds).toBe(tBefore); // latched → no-op
  });

  it('the forced-wave override spawns a boss through the engine (§3.2)', () => {
    const ctx = createTestContext({ seed: 5 });
    const gs = createGameState(ctx.content, 5);
    const engine = createEngine(gs, ctx);
    applySpawnOverride(gs.combat, { spawnMultiplier: 1, queuedBoss: true });

    engine.step(1 / 60, NO_FIRE);

    expect(gs.combat.drones.some((d) => d.kind === 'boss')).toBe(true);
  });

  it('every ruble-awarding drone kind is a scoring basePoints key (drift guard)', () => {
    const scored = Object.keys(scoringBalance.basePoints);
    for (const d of DRONES) {
      if (d.kind === 'decoy_bird') {
        expect(scored).not.toContain('decoy_bird'); // intentionally 0 points
        continue;
      }
      expect(scored).toContain(d.kind);
    }
  });
});
