/**
 * The machine gun (docs/areas/01-gameplay-engine.md §3.4/§3.5/§3.7). Turn-rate-limited aim toward the
 * effective angle, continuous fire gated by a fire interval, heat/overheat, and a jam hook. All pure
 * over `CombatState` + the injected `dt`/`ctx`; randomness only via the per-run gun `swayPhase` (seeded
 * once by the engine), never `Math.random()`.
 */
import { v2, lerp, clamp } from '../../core/math';
import type { Vec2 } from '../../core/math';
import type { SystemContext } from '../../core/system-context';
import type { CombatState, GunState, IncidentFlags } from '../../state/game-state';
import type { MeterEffects } from '../meters';
import type { CombatBalance } from '../../content/balance';
import type { AimModifier, PlayerIntent } from './types';

const TWO_PI = Math.PI * 2;
const SHOT_RATE_EWMA = 0.1; // smoothing for recentShotRate (read by Meters' fire-thirst nudge)

/** Wrap an angle to (-π, π]. */
export function normalizeAngle(a: number): number {
  let x = a % TWO_PI;
  if (x <= -Math.PI) x += TWO_PI;
  else if (x > Math.PI) x -= TWO_PI;
  return x;
}

/** Step `current` toward `target` by at most `maxStep`, along the shortest arc. */
export function approachAngle(current: number, target: number, maxStep: number): number {
  const diff = normalizeAngle(target - current);
  if (Math.abs(diff) <= maxStep) return target;
  return normalizeAngle(current + Math.sign(diff) * maxStep);
}

/** Translate the Meters debuff struct into the engine's aim modifier (§3.7). */
export function deriveAimModifier(eff: MeterEffects, balance: CombatBalance): AimModifier {
  return {
    swayAmplitude: eff.aimSway * balance.aim.swayRadPerUnit,
    swayFrequency: balance.aim.swayFrequencyHz,
    drunkWobble: eff.drunk ? balance.aim.drunkWobbleRad : 0,
    drunkFrequency: balance.aim.drunkFrequencyHz,
    steadinessPenalty: clamp(eff.turnSlow, 0, 1),
  };
}

/**
 * Apply the aim modifier to a desired angle, producing the effective firing angle. Deterministic:
 * a time-based sine using the per-run gun `swayPhase` (seeded once from `ctx.rng`), so a zeroed
 * modifier returns `desired` unchanged and any nonzero modifier yields a reproducible offset for a
 * given `(swayPhase, t)`. (The spec sketched an extra `rng` arg; the seeded phase makes it redundant.)
 */
export function applyAimModifier(gun: GunState, desired: number, mod: AimModifier, tSeconds: number): number {
  if (mod.swayAmplitude === 0 && mod.drunkWobble === 0) return desired;
  const sway = mod.swayAmplitude * Math.sin(TWO_PI * mod.swayFrequency * tSeconds + gun.swayPhase);
  const drunk = mod.drunkWobble * Math.sin(TWO_PI * mod.drunkFrequency * tSeconds + gun.swayPhase * 1.3);
  return desired + sway + drunk;
}

/** Incident/Economy hook: set or lift the barrel jam (docs §3.5 / §4). */
export function setJam(combat: CombatState, jammed: boolean): void {
  combat.gun.jammed = jammed;
  if (!jammed) combat.gun.jamClearProgress = 0;
}

/** Economy "gun-jam clearing" service: clear the jam outright (docs §3.5). */
export function clearJam(combat: CombatState): void {
  setJam(combat, false);
}

function angleTo(from: Vec2, to: Vec2): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

/**
 * Per-tick gun update: resolve desired aim (pointer or keyboard), slew the barrel, apply the meter
 * sway, then fire / cool / process overheat and jam. Spawns projectiles into `combat.projectiles`
 * and emits `shotFired`. `tSeconds` is the run-elapsed time driving the deterministic sway.
 */
export function updateGun(
  combat: CombatState,
  dt: number,
  ctx: SystemContext,
  mod: AimModifier,
  flags: IncidentFlags,
  intent: PlayerIntent,
  tSeconds: number,
): void {
  const gun = combat.gun;
  const B = ctx.content.combat;
  const locked = flags.inputLocked;
  const effTurnRate = B.gun.turnRate * (1 - mod.steadinessPenalty);

  // 1. Desired aim: pointer wins; otherwise keyboard rotation; locked input freezes the barrel.
  let desired = combat.aim.desiredAngle;
  if (!locked) {
    if (intent.aimTarget) {
      desired = angleTo(gun.pivot, intent.aimTarget);
    } else if (intent.rotateDir !== 0) {
      desired = normalizeAngle(gun.angle + intent.rotateDir * effTurnRate * dt);
    }
  }
  combat.aim.desiredAngle = desired;

  // 2. Slew the barrel toward desired at the (steadiness-scaled) turn rate, then apply sway.
  gun.angle = approachAngle(gun.angle, desired, effTurnRate * dt);
  combat.aim.effectiveAngle = applyAimModifier(gun, gun.angle, mod, tSeconds);

  // 3. Firing intent.
  gun.firing = intent.fireHeld && !locked;

  // 4. Jam: no shots; holding fire mashes the clear toward the threshold.
  if (gun.jammed) {
    if (gun.firing) {
      gun.jamClearProgress += B.gun.jamClearPerInput * dt;
      if (gun.jamClearProgress >= B.gun.jamClearThreshold) setJam(combat, false);
    }
    gun.heat = Math.max(0, gun.heat - B.gun.coolRate * dt);
    gun.recentShotRate = lerp(gun.recentShotRate, 0, SHOT_RATE_EWMA);
    return;
  }

  // 5. Overheat lock: cool until below the resume threshold; no shots meanwhile.
  if (gun.overheated) {
    gun.heat = Math.max(0, gun.heat - B.gun.coolRate * dt);
    if (gun.heat < B.gun.cooloffResume) gun.overheated = false;
    gun.recentShotRate = lerp(gun.recentShotRate, 0, SHOT_RATE_EWMA);
    return;
  }

  // 6. Fire on cooldown while held (loop covers fire rates faster than one shot per tick).
  gun.fireCooldown -= dt;
  let firedThisTick = false;
  while (gun.firing && gun.fireCooldown <= 0 && !gun.overheated) {
    fireShot(combat, ctx);
    firedThisTick = true;
    gun.fireCooldown += 1 / B.gun.fireRate;
    gun.heat += B.gun.heatPerShot;
    if (gun.heat >= 100) {
      gun.heat = 100;
      gun.overheated = true;
    }
  }

  // 7. Cool while not firing; track the firing EWMA Meters reads for fire-thirst.
  if (!gun.firing) gun.heat = Math.max(0, gun.heat - B.gun.coolRate * dt);
  if (gun.fireCooldown < 0) gun.fireCooldown = 0;
  gun.recentShotRate = lerp(gun.recentShotRate, firedThisTick || gun.firing ? 1 : 0, SHOT_RATE_EWMA);
}

function fireShot(combat: CombatState, ctx: SystemContext): void {
  const B = ctx.content.combat;
  const gun = combat.gun;
  const dir: Vec2 = { x: Math.cos(combat.aim.effectiveAngle), y: Math.sin(combat.aim.effectiveAngle) };
  const proj = {
    id: combat.nextProjectileId++,
    pos: { ...gun.pivot },
    prev: { ...gun.pivot },
    vel: v2.scale(dir, B.projectile.speed),
    ttl: B.projectile.ttl,
    radius: B.projectile.radius,
  };
  combat.projectiles.push(proj);
  if (combat.projectiles.length > B.projectile.cap) combat.projectiles.shift();
  ctx.events.emit('shotFired', { from: { ...gun.pivot }, angle: combat.aim.effectiveAngle });
}
