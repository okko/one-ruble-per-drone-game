/**
 * Need-meters system (docs/areas/02-meters-and-status.md). Pure logic over `MetersState`: the drain
 * model, the read-only `MeterEffects` debuff struct, the crisis lifecycle (enter/leave with
 * hysteresis), the compound/single-meter game-over rule, and the relief API. No imports of
 * render/audio/DOM; deterministic; all magnitudes come from `ctx.content.meters` (the balance table).
 *
 * Cross-slice reads come in via the `MetersRead` view (assembled by the Engine from GameState) rather
 * than `ctx.state`, keeping this module decoupled from the combat/incidents slice shapes (see plan D1).
 */
import { clamp } from '../core/math';
import { METER_KEYS } from '../types/meter-key';
import type { MeterKey } from '../types/meter-key';
import type { SystemContext } from '../core/system-context';
import type { MetersState } from '../state/game-state';
import type { MeterBalance } from '../content/meters';

/** HUD indicator glyphs (docs/areas/02 §4). The poo icon must read as 💩 (Art renders the pixel icon). */
export const METER_INDICATORS: Readonly<Record<MeterKey, string>> = {
  sleep: '😴',
  poo: '💩',
  hunger: '🍞',
  thirst: '💧',
  vice: '🚬',
};

/** Computed, read-only debuff struct consumed by Gameplay Engine / HUD / Render (§3.3). */
export interface MeterEffects {
  aimSway: number; // 0..2, added to gun jitter amplitude
  aimDriftBias: number; // -1..1, steady drift (drunk)
  moveSlow: number; // 0..1, fraction subtracted from move speed
  turnSlow: number; // 0..1, fraction subtracted from turn speed
  interactSlow: number; // 0..1, slows service/menu interactions
  visionDim: number; // 0..1, darken overlay (sleep)
  visionBlur: number; // 0..1, blur overlay (thirst)
  microSleepChancePerSec: number; // 0..1, prob/sec of a brief input dropout
  drunk: boolean;
}

export type ReliefKind = 'food' | 'water' | 'toilet' | 'cigarette' | 'vodka' | 'coffee' | 'nap';

export interface ReliefResult {
  applied: boolean; // false if blocked (e.g. toilet during pipe failure)
  reason?: 'pipe_failure';
}

/** Cross-slice inputs the per-tick update reads (Engine assembles these from GameState each tick). */
export interface MetersRead {
  phase: 'day' | 'night';
  difficulty: number;
  recentShotRate: number; // 0..1 EWMA of fire (combat); 0 if unavailable
  sleepGainMultiplier: number; // incidents flag (blackout/party); default 1
  // Run stats used only to populate the gameOver payload on a crisis collapse:
  shiftSeconds: number;
  score: number;
  dronesDowned: number;
}

function zeroRecord(): Record<MeterKey, number> {
  return { sleep: 0, poo: 0, hunger: 0, thirst: 0, vice: 0 };
}
function falseRecord(): Record<MeterKey, boolean> {
  return { sleep: false, poo: false, hunger: false, thirst: false, vice: false };
}

export function createMetersState(): MetersState {
  return {
    values: zeroRecord(),
    inCrisis: falseRecord(),
    crisisTimer: zeroRecord(),
    compoundTimer: 0,
    coffeeTimer: 0,
    drunkTimer: 0,
  };
}

export function isCrisis(m: MetersState, k: MeterKey): boolean {
  return m.inCrisis[k];
}

/** Normalized severity above warn: 0 at/below warn, 1 at 100 (§3.3). */
function severity(value: number, warn: number): number {
  if (value <= warn) return 0;
  return clamp((value - warn) / (100 - warn), 0, 1);
}

/**
 * Apply a signed change to a meter (positive raises toward crisis, negative relieves), clamp to
 * [0,100], then reconcile the crisis edge so enter/leave events fire from a single place.
 */
function adjust(m: MetersState, k: MeterKey, delta: number, ctx: SystemContext): void {
  m.values[k] = clamp(m.values[k] + delta, 0, 100);
  reconcileEdge(m, k, ctx);
}

/** Emit the enter/leave-crisis transition for one meter based on its current value (§3.4). */
function reconcileEdge(m: MetersState, k: MeterKey, ctx: SystemContext): void {
  const hysteresis = ctx.content.meters.tunables.hysteresis;
  const v = m.values[k];
  if (!m.inCrisis[k] && v >= 100) {
    m.inCrisis[k] = true;
    m.crisisTimer[k] = 0;
    ctx.events.emit('meterCrisis', { meter: k, entered: true });
    if (k === 'poo') ctx.events.emit('pooAccident', {});
  } else if (m.inCrisis[k] && v < 100 - hysteresis) {
    m.inCrisis[k] = false;
    m.crisisTimer[k] = 0;
    ctx.events.emit('meterCrisis', { meter: k, entered: false });
  }
}

/**
 * Subtract `amount` from a meter (negative `amount` raises it — used for degraded-favor side
 * effects), routed through the same clamp + crisis-edge logic so raw reliefs still fire the
 * leave-crisis path (plan D3). This is the sink the economy relief-bridge composes onto.
 */
export function applyRawRelief(m: MetersState, meter: MeterKey, amount: number, ctx: SystemContext): void {
  adjust(m, meter, -amount, ctx);
}

/** Per-tick drain + crisis bookkeeping (§3.2, §3.4). Mutates `m` in place. */
export function update(m: MetersState, dt: number, ctx: SystemContext, read: MetersRead): void {
  const B = ctx.content.meters;
  const diff = 1 + B.tunables.diffCreepPerLevel * read.difficulty;

  // Timed effects decay first.
  m.coffeeTimer = Math.max(0, m.coffeeTimer - dt);
  m.drunkTimer = Math.max(0, m.drunkTimer - dt);

  const nightSleepMul = read.phase === 'night' ? B.modifiers.nightSleepMul : 1;
  const viceJitterMul = isCrisis(m, 'vice') ? B.modifiers.viceJitterSleepMul : 1;
  const coffeeOffset = m.coffeeTimer > 0 ? B.rates.coffeeSleepRelief : 0;
  const dayThirstMul = read.phase === 'day' ? B.modifiers.dayThirstMul : 1;
  const fireThirst = B.modifiers.fireThirstCoeff * read.recentShotRate;

  // Thirst over warn multiplies sleep & hunger gain (§3.2 note / §3.3 thirst row).
  const sThirst = severity(m.values.thirst, B.warn.thirst);
  const thirstGain = sThirst > 0 ? 1 + B.modifiers.thirstGainMul * sThirst : 1;

  const sleepRate = B.rates.sleep * nightSleepMul * viceJitterMul * read.sleepGainMultiplier * thirstGain;
  adjust(m, 'sleep', (sleepRate - coffeeOffset) * diff * dt, ctx);
  adjust(m, 'poo', B.rates.poo * diff * dt, ctx);
  adjust(m, 'hunger', B.rates.hunger * thirstGain * diff * dt, ctx);
  adjust(m, 'thirst', (B.rates.thirst * dayThirstMul + fireThirst) * diff * dt, ctx);
  adjust(m, 'vice', B.rates.vice * diff * dt, ctx);

  tickCrisisTimers(m, dt, ctx, read);
}

function tickCrisisTimers(m: MetersState, dt: number, ctx: SystemContext, read: MetersRead): void {
  const { graceSeconds, compoundGrace } = ctx.content.meters.tunables;

  const crises: MeterKey[] = [];
  for (const k of METER_KEYS) {
    if (m.inCrisis[k]) {
      m.crisisTimer[k] += dt;
      crises.push(k);
    }
  }

  const prevCompound = m.compoundTimer;
  m.compoundTimer = crises.length >= 2 ? m.compoundTimer + dt : 0;

  // Compound game-over: >= 2 crises sustained for compoundGrace (fires once, on the crossing tick).
  if (crises.length >= 2 && prevCompound < compoundGrace && m.compoundTimer >= compoundGrace) {
    const cause = `compound:${[...crises].sort().join('+')}`;
    emitGameOver(ctx, read, cause);
    return;
  }

  // Single-meter collapse: any one meter pinned in crisis for graceSeconds (once, on crossing).
  for (const k of METER_KEYS) {
    if (m.inCrisis[k] && m.crisisTimer[k] - dt < graceSeconds && m.crisisTimer[k] >= graceSeconds) {
      emitGameOver(ctx, read, `collapse:${k}`);
      return;
    }
  }
}

function emitGameOver(ctx: SystemContext, read: MetersRead, cause: string): void {
  ctx.events.emit('gameOver', {
    score: read.score,
    cause,
    shiftSeconds: read.shiftSeconds,
    dronesDowned: read.dronesDowned,
  });
}

/** Relief API the economy calls (via the bridge) and any direct caller uses (§3.5). */
export function applyRelief(
  m: MetersState,
  kind: ReliefKind,
  ctx: SystemContext,
  opts?: { quality?: number; pipeFailure?: boolean },
): ReliefResult {
  const q = opts?.quality ?? 1;
  const R = ctx.content.meters.relief;

  switch (kind) {
    case 'food':
      applyRawRelief(m, 'hunger', R.foodHunger * q, ctx);
      adjust(m, 'poo', R.foodPooKick + R.foodPooKickDegradedExtra * (1 - q), ctx);
      return { applied: true };
    case 'water':
      applyRawRelief(m, 'thirst', R.waterThirst * q, ctx);
      adjust(m, 'poo', R.waterPooKick, ctx);
      return { applied: true };
    case 'toilet':
      if (opts?.pipeFailure) return { applied: false, reason: 'pipe_failure' };
      applyRawRelief(m, 'poo', R.toiletPoo * q, ctx);
      return { applied: true };
    case 'cigarette':
      applyRawRelief(m, 'vice', R.cigaretteVice * q, ctx);
      return { applied: true };
    case 'vodka':
      applyRawRelief(m, 'vice', R.vodkaVice * q, ctx);
      applyRawRelief(m, 'sleep', R.vodkaSleep * q, ctx);
      m.drunkTimer = R.drunkSeconds * q;
      return { applied: true };
    case 'coffee':
      m.coffeeTimer = R.coffeeSeconds;
      return { applied: true };
    case 'nap':
      applyRawRelief(m, 'sleep', R.napSleep * q, ctx);
      return { applied: true };
  }
}

/**
 * Set the transient drunk timer (vodka side effect) without re-applying vice/sleep deltas — used by
 * the economy relief-bridge so a roster-authored vodka relief keeps its own magnitudes (plan D3).
 */
export function setDrunk(m: MetersState, ctx: SystemContext, quality = 1): void {
  m.drunkTimer = ctx.content.meters.relief.drunkSeconds * quality;
}

/** Set the coffee timer (temporary sleep-gain relief) — used by the bridge for `effect:'coffee'`. */
export function setCoffee(m: MetersState, ctx: SystemContext): void {
  m.coffeeTimer = ctx.content.meters.relief.coffeeSeconds;
}

/** Read-only debuff aggregation (§3.3). Consumers read; never write. */
export function computeEffects(m: MetersState, balance: MeterBalance): MeterEffects {
  const E = balance.effects;
  const W = balance.warn;
  const eff: MeterEffects = {
    aimSway: 0,
    aimDriftBias: 0,
    moveSlow: 0,
    turnSlow: 0,
    interactSlow: 0,
    visionDim: 0,
    visionBlur: 0,
    microSleepChancePerSec: 0,
    drunk: false,
  };

  const sSleep = severity(m.values.sleep, W.sleep);
  eff.microSleepChancePerSec += E.sleepMicroSleep * sSleep;
  eff.visionDim += E.sleepVisionDim * sSleep;
  eff.aimSway += E.sleepAimSway * sSleep;

  const sPoo = severity(m.values.poo, W.poo);
  eff.moveSlow += E.pooMoveSlow * sPoo;
  eff.turnSlow += E.pooTurnSlow * sPoo;

  const sHunger = severity(m.values.hunger, W.hunger);
  eff.aimSway += E.hungerAimSway * sHunger;
  eff.interactSlow += E.hungerInteractSlow * sHunger;

  const sThirst = severity(m.values.thirst, W.thirst);
  eff.visionBlur += E.thirstVisionBlur * sThirst;

  const sVice = severity(m.values.vice, W.vice);
  eff.aimSway += E.viceAimSway * sVice;

  if (m.drunkTimer > 0) {
    eff.aimSway += E.drunkAimSway;
    eff.aimDriftBias += E.drunkBias;
    eff.drunk = true;
  }

  eff.aimSway = clamp(eff.aimSway, 0, 2);
  eff.aimDriftBias = clamp(eff.aimDriftBias, -1, 1);
  eff.moveSlow = clamp(eff.moveSlow, 0, 1);
  eff.turnSlow = clamp(eff.turnSlow, 0, 1);
  eff.interactSlow = clamp(eff.interactSlow, 0, 1);
  eff.visionDim = clamp(eff.visionDim, 0, 1);
  eff.visionBlur = clamp(eff.visionBlur, 0, 1);
  eff.microSleepChancePerSec = clamp(eff.microSleepChancePerSec, 0, 1);
  return eff;
}

/** True while every meter is below its warn threshold (the tidy-bonus "all green" check, §3.3). */
export function getAllMetersGreen(m: MetersState, balance: MeterBalance): boolean {
  return METER_KEYS.every((k) => m.values[k] < balance.warn[k]);
}
