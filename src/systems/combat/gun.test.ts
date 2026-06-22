import { describe, it, expect } from 'vitest';
import { createTestContext } from '../../test-support/context';
import { combatBalance } from '../../content/balance';
import type { CombatBalance } from '../../content/balance';
import { DEFAULT_FLAGS } from '../incidents';
import type { IncidentFlags } from '../../state/game-state';
import { createCombatState } from './combat';
import { updateGun, applyAimModifier, deriveAimModifier, normalizeAngle, approachAngle, setJam } from './gun';
import type { AimModifier, PlayerIntent } from './types';
import type { MeterEffects } from '../meters';

const ZERO_MOD: AimModifier = {
  swayAmplitude: 0,
  swayFrequency: 0,
  drunkWobble: 0,
  drunkFrequency: 0,
  steadinessPenalty: 0,
};

function flags(over: Partial<IncidentFlags> = {}): IncidentFlags {
  return { ...DEFAULT_FLAGS, ...over };
}

function setup(combatOverride?: Partial<CombatBalance>) {
  const ctx = createTestContext(
    combatOverride ? { content: { combat: { ...combatBalance, ...combatOverride } } } : {},
  );
  const combat = createCombatState(ctx.content);
  const shots: number[] = [];
  ctx.events.on('shotFired', () => shots.push(1));
  return { ctx, combat, shotCount: () => shots.length };
}

const hold: PlayerIntent = { aimTarget: null, rotateDir: 0, fireHeld: true };
const idle: PlayerIntent = { aimTarget: null, rotateDir: 0, fireHeld: false };

describe('gun: angle helpers', () => {
  it('normalizeAngle wraps to (-π, π]', () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(Math.PI * 2)).toBeCloseTo(0, 9);
    expect(normalizeAngle(Math.PI * 3)).toBeCloseTo(Math.PI, 9);
  });

  it('approachAngle steps along the shortest arc and snaps when within range', () => {
    expect(approachAngle(0, 0.05, 1)).toBe(0.05); // within maxStep → snap
    expect(approachAngle(0, 3, 0.1)).toBeCloseTo(0.1, 9); // step toward
    // shortest arc from 0.1 to -3.1 wraps the POSITIVE way (3.08 < 3.2 rad), so it increases
    expect(approachAngle(0.1, -3.1, 0.1)).toBeCloseTo(0.2, 9);
  });
});

describe('gun: aim modifier (§8.12)', () => {
  it('returns the desired angle unchanged for a zeroed modifier', () => {
    const { combat } = setup();
    combat.gun.swayPhase = 1.23;
    expect(applyAimModifier(combat.gun, 0.5, ZERO_MOD, 3)).toBe(0.5);
  });

  it('is deterministic for a given (swayPhase, t) and varies with t, bounded by amplitude', () => {
    const { combat } = setup();
    combat.gun.swayPhase = 0.7;
    const mod: AimModifier = { swayAmplitude: 0.2, swayFrequency: 0.7, drunkWobble: 0, drunkFrequency: 0.4, steadinessPenalty: 0 };
    const a = applyAimModifier(combat.gun, 0, mod, 1.0);
    const b = applyAimModifier(combat.gun, 0, mod, 1.0);
    const c = applyAimModifier(combat.gun, 0, mod, 1.5);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(Math.abs(a)).toBeLessThanOrEqual(0.2 + 1e-9);
  });

  it('deriveAimModifier maps MeterEffects (sway/turnSlow/drunk) into the modifier', () => {
    const eff: MeterEffects = {
      aimSway: 1,
      aimDriftBias: 0,
      moveSlow: 0,
      turnSlow: 0.5,
      interactSlow: 0,
      visionDim: 0,
      visionBlur: 0,
      microSleepChancePerSec: 0,
      drunk: true,
    };
    const mod = deriveAimModifier(eff, combatBalance);
    expect(mod.swayAmplitude).toBeCloseTo(combatBalance.aim.swayRadPerUnit, 9);
    expect(mod.steadinessPenalty).toBe(0.5);
    expect(mod.drunkWobble).toBe(combatBalance.aim.drunkWobbleRad);
  });

  it('steadinessPenalty slows the barrel turn rate; a full penalty freezes it', () => {
    const { ctx, combat: c1 } = setup();
    const c2 = createCombatState(ctx.content);
    const target = { x: c1.gun.pivot.x + 50, y: c1.gun.pivot.y }; // to the right of the upward start
    const intent: PlayerIntent = { aimTarget: target, rotateDir: 0, fireHeld: false };
    updateGun(c1, 1 / 60, ctx, ZERO_MOD, flags(), intent, 0);
    updateGun(c2, 1 / 60, ctx, { ...ZERO_MOD, steadinessPenalty: 1 }, flags(), intent, 0);
    const moved1 = Math.abs(normalizeAngle(c1.gun.angle - -Math.PI / 2));
    const moved2 = Math.abs(normalizeAngle(c2.gun.angle - -Math.PI / 2));
    expect(moved1).toBeGreaterThan(moved2);
    expect(moved2).toBe(0);
  });
});

describe('gun: firing, cooldown, overheat (§8.9, §8.10)', () => {
  it('holding fire produces shots at roughly fireRate spacing', () => {
    const { ctx, combat, shotCount } = setup();
    for (let i = 0; i < 60; i++) updateGun(combat, 1 / 60, ctx, ZERO_MOD, flags(), hold, 0);
    expect(shotCount()).toBeGreaterThanOrEqual(9); // fireRate 10/s over 1s
    expect(shotCount()).toBeLessThanOrEqual(11);
  });

  it('enforces the cooldown: no second shot before 1/fireRate elapses', () => {
    const { ctx, combat, shotCount } = setup({ gun: { ...combatBalance.gun, fireRate: 2 } });
    updateGun(combat, 1 / 60, ctx, ZERO_MOD, flags(), hold, 0); // first shot
    expect(shotCount()).toBe(1);
    for (let i = 0; i < 20; i++) updateGun(combat, 1 / 60, ctx, ZERO_MOD, flags(), hold, 0); // ~0.33s < 0.5s
    expect(shotCount()).toBe(1);
  });

  it('overheats under sustained fire, locks, then resumes after cooling below cooloffResume', () => {
    const { ctx, combat, shotCount } = setup({ gun: { ...combatBalance.gun, heatPerShot: 30 } });
    for (let i = 0; i < 120; i++) updateGun(combat, 1 / 60, ctx, ZERO_MOD, flags(), hold, 0);
    expect(combat.gun.overheated).toBe(true);
    const lockedShots = shotCount();
    // Release and cool down.
    for (let i = 0; i < 300; i++) updateGun(combat, 1 / 60, ctx, ZERO_MOD, flags(), idle, 0);
    expect(combat.gun.overheated).toBe(false);
    expect(combat.gun.heat).toBeLessThan(combatBalance.gun.cooloffResume);
    // Fires again after resuming.
    updateGun(combat, 1 / 60, ctx, ZERO_MOD, flags(), hold, 0);
    expect(shotCount()).toBeGreaterThan(lockedShots);
  });
});

describe('gun: jam hook (§8.11)', () => {
  it('a jam disables fire; mashing clears it and firing resumes', () => {
    const { ctx, combat, shotCount } = setup();
    setJam(combat, true);
    for (let i = 0; i < 30; i++) updateGun(combat, 1 / 60, ctx, ZERO_MOD, flags(), hold, 0);
    expect(shotCount()).toBe(0); // jammed → no shots
    expect(combat.gun.jamClearProgress).toBeGreaterThan(0);
    // jamClearPerInput 25/s, threshold 100 → ~4s of mashing clears it.
    for (let i = 0; i < 300; i++) updateGun(combat, 1 / 60, ctx, ZERO_MOD, flags(), hold, 0);
    expect(combat.gun.jammed).toBe(false);
    expect(shotCount()).toBeGreaterThan(0);
  });
});
