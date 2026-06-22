import { describe, it, expect } from 'vitest';
import { createTestContext } from '../../test-support/context';
import { combatBalance } from '../../content/balance';
import { DEFAULT_FLAGS } from '../incidents';
import type { SystemContext } from '../../core/system-context';
import type { CombatState, Drone } from '../../state/game-state';
import { createCombatState, updateCombat } from './combat';
import type { CombatTickInput } from './combat';
import { IDLE_INTENT } from './types';
import type { AimModifier } from './types';

const ZERO_MOD: AimModifier = { swayAmplitude: 0, swayFrequency: 0, drunkWobble: 0, drunkFrequency: 0, steadinessPenalty: 0 };

function tickInput(over: Partial<CombatTickInput> = {}): CombatTickInput {
  return { D: 0, aimMod: ZERO_MOD, flags: { ...DEFAULT_FLAGS }, intent: IDLE_INTENT, tSeconds: 0, score: 0, ...over };
}

function setup() {
  const ctx = createTestContext({ seed: 99 });
  const combat = createCombatState(ctx.content);
  combat.director.timer = 9999; // suppress auto-spawns; tests inject their own drones
  return { ctx, combat };
}

function capture<T>(ctx: SystemContext, key: Parameters<SystemContext['events']['on']>[0]): T[] {
  const out: T[] = [];
  ctx.events.on(key, (p) => out.push(p as T));
  return out;
}

function spawnDroneAt(
  combat: CombatState,
  pos: { x: number; y: number },
  hp: number,
  opts: { kind?: string; awardsRuble?: boolean; escapeDamage?: number } = {},
): Drone {
  const d: Drone = {
    id: combat.nextDroneId++,
    kind: opts.kind ?? 'scout',
    pos: { ...pos },
    vel: { x: 0, y: 0 },
    hp,
    maxHp: hp,
    radius: 8,
    movement: { kind: 'straight', speed: 0, origin: { ...pos }, target: { x: pos.x, y: pos.y + 400 }, amplitude: 0, frequency: 0, phase: 0, accel: 0, elapsed: 0 },
    escapeDamage: opts.escapeDamage ?? 10,
    awardsRuble: opts.awardsRuble ?? true,
  };
  combat.drones.push(d);
  return d;
}

function hitOnce(combat: CombatState, target: { x: number; y: number }): void {
  combat.projectiles.push({ id: combat.nextProjectileId++, pos: { ...target }, prev: { ...target }, vel: { x: 0, y: 0 }, ttl: 1, radius: 1.5 });
}

describe('combat: kills, escapes, and loss (§8.4-§8.8)', () => {
  it('destroying a drone emits droneDestroyed{byPlayer} and counts the downing', () => {
    const { ctx, combat } = setup();
    const destroyed = capture<{ kind: string; byPlayer: boolean }>(ctx, 'droneDestroyed');
    const d = spawnDroneAt(combat, { x: 192, y: 100 }, 1, { kind: 'scout' });
    hitOnce(combat, d.pos);
    updateCombat(combat, 1 / 60, ctx, tickInput());
    expect(destroyed).toHaveLength(1);
    expect(destroyed[0]).toMatchObject({ kind: 'scout', byPlayer: true });
    expect(combat.dronesDowned).toBe(1);
    expect(combat.drones).toHaveLength(0);
  });

  it('a decoy emits droneDestroyed with its kind (the no-ruble rule is the engine income handler)', () => {
    const { ctx, combat } = setup();
    const destroyed = capture<{ kind: string }>(ctx, 'droneDestroyed');
    const d = spawnDroneAt(combat, { x: 192, y: 100 }, 1, { kind: 'decoy_bird', awardsRuble: false });
    hitOnce(combat, d.pos);
    updateCombat(combat, 1 / 60, ctx, tickInput());
    expect(destroyed[0]).toMatchObject({ kind: 'decoy_bird' });
  });

  it('a drone with hp N survives N-1 hits and dies on the Nth (§8.8)', () => {
    const { ctx, combat } = setup();
    const d = spawnDroneAt(combat, { x: 192, y: 100 }, 3);
    hitOnce(combat, d.pos);
    hitOnce(combat, d.pos);
    updateCombat(combat, 1 / 60, ctx, tickInput());
    expect(d.hp).toBe(1);
    expect(combat.drones).toHaveLength(1);
    expect(combat.dronesDowned).toBe(0);
    hitOnce(combat, d.pos);
    updateCombat(combat, 1 / 60, ctx, tickInput());
    expect(combat.dronesDowned).toBe(1);
    expect(combat.drones).toHaveLength(0);
  });

  it('a drone reaching the post emits droneEscaped and damages Post Integrity (§8.6)', () => {
    const { ctx, combat } = setup();
    const escaped = capture<{ damage: number }>(ctx, 'droneEscaped');
    spawnDroneAt(combat, { ...combatBalance.postTarget }, 3, { escapeDamage: 18 });
    updateCombat(combat, 1 / 60, ctx, tickInput());
    expect(escaped).toHaveLength(1);
    expect(escaped[0]).toMatchObject({ damage: 18 });
    expect(combat.postIntegrity).toBe(combatBalance.postIntegrityMax - 18);
    expect(combat.drones).toHaveLength(0);
  });

  it('Post Integrity reaching 0 emits exactly one gameOver and halts the sim (§8.7)', () => {
    const { ctx, combat } = setup();
    const go = capture<{ cause: string; score: number }>(ctx, 'gameOver');
    combat.postIntegrity = 10;
    spawnDroneAt(combat, { ...combatBalance.postTarget }, 3, { escapeDamage: 50 });
    updateCombat(combat, 1 / 60, ctx, tickInput({ score: 1234 }));
    expect(go).toHaveLength(1);
    expect(go[0]).toMatchObject({ cause: 'post-destroyed', score: 1234 });
    expect(combat.gameOverEmitted).toBe(true);
    // A further tick (even one that would normally spawn) emits nothing and does not simulate.
    combat.director.timer = 0;
    updateCombat(combat, 1, ctx, tickInput());
    expect(go).toHaveLength(1);
    expect(combat.drones).toHaveLength(0);
  });
});
