import { describe, it, expect } from 'vitest';
import { createTestContext } from '../../test-support/context';
import { combatBalance } from '../../content/balance';
import { createGameState } from '../../state/create-game-state';
import type { SystemContext } from '../../core/system-context';
import { createEngine } from './engine';
import type { PlayerIntent } from './types';

function capture<T>(ctx: SystemContext, key: Parameters<SystemContext['events']['on']>[0]): T[] {
  const out: T[] = [];
  ctx.events.on(key, (p) => out.push(p as T));
  return out;
}

const sky = { x: 200, y: 50 };

describe('engine: ruble income handler (§8.4, §8.5)', () => {
  it('banks +1 ruble for a player kill that awards one, but not for decoys or non-player kills', () => {
    const ctx = createTestContext({ seed: 5 });
    const gs = createGameState(ctx.content, 5);
    createEngine(gs, ctx);

    ctx.events.emit('droneDestroyed', { id: 1, kind: 'scout', byPlayer: true, pos: { x: 0, y: 0 } });
    expect(gs.economy.rubles).toBe(1);

    ctx.events.emit('droneDestroyed', { id: 2, kind: 'decoy_bird', byPlayer: true, pos: { x: 0, y: 0 } });
    expect(gs.economy.rubles).toBe(1); // decoy → no ruble

    ctx.events.emit('droneDestroyed', { id: 3, kind: 'scout', byPlayer: false, pos: { x: 0, y: 0 } });
    expect(gs.economy.rubles).toBe(1); // not a player kill
  });

  it('a player kill also feeds Scoring (registered by the engine)', () => {
    const ctx = createTestContext({ seed: 6 });
    const gs = createGameState(ctx.content, 6);
    createEngine(gs, ctx);
    ctx.events.emit('droneDestroyed', { id: 1, kind: 'scout', byPlayer: true, pos: { x: 0, y: 0 } });
    expect(gs.scoring.comboCount).toBe(1);
    expect(gs.scoring.score).toBeGreaterThan(0);
  });
});

describe('engine: master tick', () => {
  it('advances the shift clock, difficulty/phase, and drains meters', () => {
    const ctx = createTestContext({ seed: 7 });
    const gs = createGameState(ctx.content, 7);
    const engine = createEngine(gs, ctx);
    for (let i = 0; i < 240; i++) engine.step(1 / 60);
    expect(gs.time.shiftSeconds).toBeCloseTo(4, 5);
    expect(gs.time.difficulty).toBeGreaterThan(0);
    expect(gs.meters.values.sleep).toBeGreaterThan(0);
  });

  it('a gameOver latches the run: subsequent steps are no-ops', () => {
    const ctx = createTestContext({ seed: 8 });
    const gs = createGameState(ctx.content, 8);
    const engine = createEngine(gs, ctx);
    engine.step(1 / 60);
    const tBefore = gs.time.shiftSeconds;
    ctx.events.emit('gameOver', { score: 0, cause: 'collapse:sleep', shiftSeconds: tBefore, dronesDowned: 0 });
    engine.step(1 / 60);
    expect(gs.time.shiftSeconds).toBe(tBefore); // latched → step did nothing
  });

  it('an active gun-jam incident jams the gun on the rising flag edge', () => {
    const ctx = createTestContext({ seed: 9 });
    const gs = createGameState(ctx.content, 9);
    const engine = createEngine(gs, ctx);
    const jamDef = ctx.content.incidents.catalog.find((d) => d.id === 'gun_jam');
    expect(jamDef).toBeDefined();
    gs.incidents.active.push({ id: 'gun_jam', phase: 'active', phaseRemaining: 999, resolvable: false });
    gs.incidents.nextIn = 9999;
    engine.step(1 / 60);
    expect(gs.incidents.flags.gunJammed).toBe(true);
    expect(gs.combat.gun.jammed).toBe(true);
  });

  it('dispose detaches the income handler', () => {
    const ctx = createTestContext({ seed: 10 });
    const gs = createGameState(ctx.content, 10);
    const engine = createEngine(gs, ctx);
    engine.dispose();
    ctx.events.emit('droneDestroyed', { id: 1, kind: 'scout', byPlayer: true, pos: { x: 0, y: 0 } });
    expect(gs.economy.rubles).toBe(0);
  });
});

describe('engine: input parity (§8.13, §8.14)', () => {
  it('keyboard-only input aims and fires the gun (§8.13)', () => {
    const ctx = createTestContext({ seed: 11 });
    const gs = createGameState(ctx.content, 11);
    const engine = createEngine(gs, ctx);
    const shots = capture(ctx, 'shotFired');
    const startAngle = gs.combat.gun.angle;
    const keyboard: PlayerIntent = { aimTarget: null, rotateDir: 1, fireHeld: true };
    for (let i = 0; i < 30; i++) engine.step(1 / 60, keyboard);
    expect(gs.combat.gun.angle).not.toBe(startAngle); // rotated by keyboard
    expect(shots.length).toBeGreaterThan(0); // fired by keyboard
  });

  it('releasing a held touch (fireUp / pointercancel) stops firing — the gun never sticks (§8.14)', () => {
    const ctx = createTestContext({ seed: 12 });
    const gs = createGameState(ctx.content, 12);
    const engine = createEngine(gs, ctx);
    const shots = capture(ctx, 'shotFired');
    const down: PlayerIntent = { aimTarget: sky, rotateDir: 0, fireHeld: true };
    const up: PlayerIntent = { aimTarget: sky, rotateDir: 0, fireHeld: false };
    for (let i = 0; i < 18; i++) engine.step(1 / 60, down);
    const held = shots.length;
    expect(held).toBeGreaterThan(0);
    for (let i = 0; i < 30; i++) engine.step(1 / 60, up);
    expect(shots.length).toBe(held); // no shots after release
  });

  it('overheat still triggers under a sustained held touch (§8.14)', () => {
    const ctx = createTestContext({ seed: 13, content: { combat: { ...combatBalance, gun: { ...combatBalance.gun, heatPerShot: 30 } } } });
    const gs = createGameState(ctx.content, 13);
    const engine = createEngine(gs, ctx);
    const down: PlayerIntent = { aimTarget: sky, rotateDir: 0, fireHeld: true };
    let sawOverheat = false;
    for (let i = 0; i < 240; i++) {
      engine.step(1 / 60, down);
      if (gs.combat.gun.overheated) sawOverheat = true;
    }
    expect(sawOverheat).toBe(true);
  });
});
