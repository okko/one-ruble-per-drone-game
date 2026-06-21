/**
 * Pinball scoring system (docs/areas/04-scoring.md). The score is the highscore metric and is fully
 * decoupled from rubles. Discrete awards/resets are driven by event handlers (combo/multiplier,
 * jackpot sequences, bonus mode, skill shots, incident-survival); `updateScoring` ticks the timers
 * and accrues the tidy bonus. Every score mutation goes through the single `addScore` path. Pure
 * logic; all values come from `ctx.content.scoring`.
 */
import type { SystemContext } from '../core/system-context';
import type { GameState, ScoringState, MultiplierStep } from '../state/game-state';
import type { ScoringBalance } from '../content/scoring';
import { getAllMetersGreen } from './meters';

export function createScoringState(): ScoringState {
  return {
    score: 0,
    comboCount: 0,
    multiplier: 1,
    comboDecayTimer: 0,
    litSequence: [],
    jackpotCompletions: 0,
    bonusModeFactor: 1,
    bonusModeTimer: 0,
    skillShotWindow: 0,
    tidyAccumulator: 0,
    tidyFlushTimer: 0,
    activeIncidentId: null,
  };
}

/** The ONLY path that mutates the score; emits exactly one scoreChanged (§3.8). */
function addScore(state: GameState, delta: number, reason: string, ctx: SystemContext): void {
  const rounded = Math.round(delta);
  state.scoring.score += rounded;
  ctx.events.emit('scoreChanged', { delta: rounded, total: state.scoring.score, reason });
}

function multiplierForCombo(combo: number, thresholds: ScoringBalance['comboThresholds']): MultiplierStep {
  let m: MultiplierStep = 1;
  for (const t of thresholds) if (combo >= t.combo) m = t.mult;
  return m;
}

function ladderOf(thresholds: ScoringBalance['comboThresholds']): MultiplierStep[] {
  return [...new Set(thresholds.map((t) => t.mult))].sort((a, b) => a - b);
}

function stepDown(mult: MultiplierStep, thresholds: ScoringBalance['comboThresholds']): MultiplierStep {
  const ladder = ladderOf(thresholds);
  const idx = ladder.indexOf(mult);
  if (idx <= 0) return 1;
  return ladder[idx - 1] ?? 1;
}

function startBonusMode(sc: ScoringState, B: ScoringBalance): void {
  sc.bonusModeFactor = Math.min(B.bonusMode.factor, B.bonusMode.maxFactor);
  sc.bonusModeTimer = B.bonusMode.durationSeconds; // re-trigger refreshes the timer; factor capped
}

function handleColorTag(state: GameState, tag: string, ctx: SystemContext): void {
  const sc = state.scoring;
  const seq = ctx.content.scoring.jackpotSequences[0];
  if (!seq) return;
  const next = seq.word[sc.litSequence.length];
  if (tag === next) {
    sc.litSequence.push(tag);
    if (sc.litSequence.length === seq.word.length) {
      const completionFactor = seq.escalates ? Math.min(sc.jackpotCompletions + 1, seq.maxMult) : 1;
      addScore(state, seq.baseValue * completionFactor * sc.multiplier, 'jackpot', ctx);
      sc.jackpotCompletions += 1;
      sc.litSequence = [];
    }
  } else {
    sc.litSequence = []; // wrong coloured special drone resets the sequence
  }
}

/** Player kill: combo++, multiplier rise, skill-shot, base points, jackpot tag, frenzy trigger (§3.1-3.5). */
export function onDroneDestroyed(
  state: GameState,
  payload: { kind: string; byPlayer: boolean; colorTag?: string },
  ctx: SystemContext,
): void {
  if (!payload.byPlayer) return;
  const sc = state.scoring;
  const B = ctx.content.scoring;
  sc.comboCount += 1;
  sc.comboDecayTimer = 0;

  const target = multiplierForCombo(sc.comboCount, B.comboThresholds);
  if (target > sc.multiplier) {
    sc.multiplier = target;
    ctx.events.emit('comboChanged', { multiplier: sc.multiplier });
  }

  if (sc.skillShotWindow > 0) {
    sc.skillShotWindow = 0;
    addScore(state, B.skillShot.bonus, 'skillshot', ctx);
  }

  const base = B.basePoints[payload.kind] ?? 0;
  addScore(state, base * sc.multiplier * sc.bonusModeFactor, 'drone', ctx);

  if (payload.colorTag !== undefined) handleColorTag(state, payload.colorTag, ctx);
  if (payload.kind === B.bonusMode.triggerKind) startBonusMode(sc, B);
}

/** A drone that reached the building is a "miss" (§3.2.3): combo to 0, multiplier soft/hard decay. */
export function onDroneEscaped(state: GameState, ctx: SystemContext): void {
  const sc = state.scoring;
  const B = ctx.content.scoring;
  sc.comboCount = 0;
  const prev = sc.multiplier;
  sc.multiplier = B.missResetMode === 'full' ? 1 : stepDown(sc.multiplier, B.comboThresholds);
  if (sc.multiplier !== prev) ctx.events.emit('comboChanged', { multiplier: sc.multiplier });
}

/** A meter entering crisis hard-resets combo & multiplier (§3.2.4). */
export function onMeterCrisis(state: GameState, payload: { entered: boolean }, ctx: SystemContext): void {
  if (!payload.entered) return;
  const sc = state.scoring;
  sc.comboCount = 0;
  sc.multiplier = 1;
  ctx.events.emit('comboChanged', { multiplier: 1 });
}

export function onIncidentStart(state: GameState, payload: { id: string }): void {
  state.scoring.activeIncidentId = payload.id;
}

/** On a survived incident, award the survival bonus (per-id, else default) (§3.7). */
export function onIncidentEnd(state: GameState, payload: { id: string; survived: boolean }, ctx: SystemContext): void {
  const sc = state.scoring;
  if (payload.survived && sc.activeIncidentId === payload.id) {
    const surv = ctx.content.scoring.incidentSurvivalBonus;
    addScore(state, surv[payload.id] ?? surv.default, 'incident-survived', ctx);
  }
  if (sc.activeIncidentId === payload.id) sc.activeIncidentId = null;
}

export function onWaveStarted(state: GameState, ctx: SystemContext): void {
  state.scoring.skillShotWindow = ctx.content.scoring.skillShot.windowSeconds;
}

/** Per-tick: count down bonus-mode / skill-shot / combo-decay timers; accrue + flush the tidy bonus. */
export function updateScoring(state: GameState, dt: number, ctx: SystemContext): void {
  const sc = state.scoring;
  const B = ctx.content.scoring;

  if (sc.bonusModeTimer > 0) {
    sc.bonusModeTimer = Math.max(0, sc.bonusModeTimer - dt);
    if (sc.bonusModeTimer === 0) sc.bonusModeFactor = 1;
  }
  if (sc.skillShotWindow > 0) sc.skillShotWindow = Math.max(0, sc.skillShotWindow - dt);

  if (sc.comboCount > 0 && Number.isFinite(B.comboDecaySeconds)) {
    sc.comboDecayTimer += dt;
    if (sc.comboDecayTimer >= B.comboDecaySeconds) {
      sc.comboCount = 0;
      sc.comboDecayTimer = 0;
    }
  }

  if (getAllMetersGreen(state.meters, ctx.content.meters)) {
    sc.tidyAccumulator += B.tidyRatePerSecond * dt;
    sc.tidyFlushTimer += dt;
    if (sc.tidyFlushTimer >= 1) {
      const whole = Math.floor(sc.tidyAccumulator);
      if (whole > 0) {
        addScore(state, whole, 'tidy', ctx);
        sc.tidyAccumulator -= whole;
      }
      sc.tidyFlushTimer = 0;
    }
  }
}

/** Wire every scoring handler to the bus; returns an unsubscribe. Used by the Engine/Playing scene. */
export function registerScoring(state: GameState, ctx: SystemContext): () => void {
  const offs = [
    ctx.events.on('droneDestroyed', (p) => onDroneDestroyed(state, p, ctx)),
    ctx.events.on('droneEscaped', () => onDroneEscaped(state, ctx)),
    ctx.events.on('meterCrisis', (p) => onMeterCrisis(state, p, ctx)),
    ctx.events.on('incidentStart', (p) => onIncidentStart(state, p)),
    ctx.events.on('incidentEnd', (p) => onIncidentEnd(state, p, ctx)),
    ctx.events.on('waveStarted', () => onWaveStarted(state, ctx)),
  ];
  return () => offs.forEach((off) => off());
}
