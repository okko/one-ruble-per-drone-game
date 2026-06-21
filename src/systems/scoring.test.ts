import { describe, it, expect } from 'vitest';
import {
  createScoringState,
  updateScoring,
  registerScoring,
  onDroneDestroyed,
  onDroneEscaped,
  onMeterCrisis,
  onIncidentStart,
  onIncidentEnd,
  onWaveStarted,
} from './scoring';
import { createTestContext } from '../test-support/context';
import { makeTestGameState } from '../test-support/game-state';
import { scoringBalance } from '../content/scoring';
import type { ScoringBalance } from '../content/scoring';
import type { GameState } from '../state/game-state';
import type { GameEvents } from '../core/events';

function setup(scoringOverride?: Partial<ScoringBalance>) {
  const ctx = createTestContext(
    scoringOverride ? { content: { scoring: { ...scoringBalance, ...scoringOverride } } } : {},
  );
  const gs = makeTestGameState(ctx.content);
  const scores: GameEvents['scoreChanged'][] = [];
  const combos: GameEvents['comboChanged'][] = [];
  ctx.events.on('scoreChanged', (p) => scores.push(p));
  ctx.events.on('comboChanged', (p) => combos.push(p));
  return { ctx, gs, scores, combos };
}

function kill(gs: GameState, ctx: ReturnType<typeof createTestContext>, kind = 'scout', colorTag?: string): void {
  onDroneDestroyed(gs, { kind, byPlayer: true, ...(colorTag ? { colorTag } : {}) }, ctx);
}

describe('scoring: combo & multiplier', () => {
  it('1. combo increments on consecutive player kills; non-player kills do not count', () => {
    const { ctx, gs } = setup();
    kill(gs, ctx);
    kill(gs, ctx);
    onDroneDestroyed(gs, { kind: 'scout', byPlayer: false }, ctx);
    expect(gs.scoring.comboCount).toBe(2);
  });

  it('3. points are basePoints*multiplier and comboChanged fires on a threshold crossing', () => {
    const { ctx, gs, scores, combos } = setup();
    for (let i = 0; i < 4; i++) kill(gs, ctx); // combo 1..4 -> x1
    expect(scores.at(-1)).toMatchObject({ delta: 100, reason: 'drone' });
    expect(combos).toHaveLength(0);
    kill(gs, ctx); // 5th: combo 5 -> x2
    expect(combos).toEqual([{ multiplier: 2 }]);
    expect(scores.at(-1)).toMatchObject({ delta: 200, reason: 'drone' }); // 100 * 2
  });

  it('2. a miss resets combo to 0 and steps the multiplier down (soft decay)', () => {
    const { ctx, gs, combos } = setup();
    for (let i = 0; i < 5; i++) kill(gs, ctx); // x2
    onDroneEscaped(gs, ctx);
    expect(gs.scoring.comboCount).toBe(0);
    expect(gs.scoring.multiplier).toBe(1); // x2 -> x1 (bottom)
    expect(combos.at(-1)).toEqual({ multiplier: 1 });
  });

  it("2. miss with missResetMode 'full' drops straight to x1 from a higher step", () => {
    const { ctx, gs } = setup({ missResetMode: 'full' });
    for (let i = 0; i < 12; i++) kill(gs, ctx); // x3
    expect(gs.scoring.multiplier).toBe(3);
    onDroneEscaped(gs, ctx);
    expect(gs.scoring.multiplier).toBe(1);
  });

  it('4. a meter entering crisis hard-resets combo & multiplier and emits comboChanged', () => {
    const { ctx, gs, combos } = setup();
    for (let i = 0; i < 12; i++) kill(gs, ctx); // x3
    onMeterCrisis(gs, { entered: true }, ctx);
    expect(gs.scoring.comboCount).toBe(0);
    expect(gs.scoring.multiplier).toBe(1);
    expect(combos.at(-1)).toEqual({ multiplier: 1 });
    const before = combos.length;
    onMeterCrisis(gs, { entered: false }, ctx); // leaving crisis does nothing
    expect(combos).toHaveLength(before);
  });
});

describe('scoring: jackpot sequences', () => {
  it('5. lighting RUBLE in order awards the jackpot; a wrong colour resets; repeats escalate', () => {
    const { ctx, gs, scores } = setup({ comboThresholds: [{ combo: 0, mult: 1 }] }); // keep x1
    kill(gs, ctx, 'scout', 'R');
    kill(gs, ctx, 'scout', 'U');
    expect(gs.scoring.litSequence).toEqual(['R', 'U']);
    kill(gs, ctx, 'scout', 'Z'); // wrong coloured special resets
    expect(gs.scoring.litSequence).toEqual([]);
    for (const c of 'RUBLE') kill(gs, ctx, 'scout', c);
    const jackpot = scores.filter((s) => s.reason === 'jackpot');
    expect(jackpot).toHaveLength(1);
    expect(jackpot[0]?.delta).toBe(5000); // 5000 * completion 1 * mult 1
    expect(gs.scoring.litSequence).toEqual([]);
    expect(gs.scoring.jackpotCompletions).toBe(1);
    for (const c of 'RUBLE') kill(gs, ctx, 'scout', c);
    expect(scores.filter((s) => s.reason === 'jackpot').at(-1)?.delta).toBe(10000); // escalated x2
  });

  it('normal (untagged) drones never touch the lit sequence', () => {
    const { ctx, gs } = setup();
    kill(gs, ctx, 'scout', 'R');
    kill(gs, ctx); // untagged
    expect(gs.scoring.litSequence).toEqual(['R']);
  });
});

describe('scoring: bonus mode', () => {
  it('6. a frenzy drone starts the mode, kills score xN, it times out, and re-trigger caps the factor', () => {
    const { ctx, gs, scores } = setup();
    kill(gs, ctx, 'frenzy'); // starts bonus mode (its own points use factor 1: 50)
    expect(gs.scoring.bonusModeFactor).toBe(5);
    expect(scores.at(-1)).toMatchObject({ delta: 50, reason: 'drone' });
    kill(gs, ctx, 'scout'); // 100 * mult 1 * factor 5 = 500
    expect(scores.at(-1)).toMatchObject({ delta: 500 });
    updateScoring(gs, 8, ctx); // bonus mode times out
    expect(gs.scoring.bonusModeFactor).toBe(1);
    kill(gs, ctx, 'scout');
    expect(scores.at(-1)).toMatchObject({ delta: 100 });
    kill(gs, ctx, 'frenzy'); // re-trigger
    expect(gs.scoring.bonusModeFactor).toBe(5); // capped at maxFactor, not stacked
    expect(gs.scoring.bonusModeTimer).toBe(8); // refreshed
  });
});

describe('scoring: skill shots', () => {
  it('7. the first kill within the window scores the bonus; later kills do not', () => {
    const { ctx, gs, scores } = setup();
    onWaveStarted(gs, ctx);
    expect(gs.scoring.skillShotWindow).toBeCloseTo(1.5, 5);
    kill(gs, ctx);
    expect(scores.some((s) => s.reason === 'skillshot' && s.delta === 500)).toBe(true);
    expect(gs.scoring.skillShotWindow).toBe(0); // closed after award
    scores.length = 0;
    kill(gs, ctx);
    expect(scores.some((s) => s.reason === 'skillshot')).toBe(false);
  });

  it('a kill after the window has elapsed earns no skill shot', () => {
    const { ctx, gs, scores } = setup();
    onWaveStarted(gs, ctx);
    updateScoring(gs, 2, ctx); // window 1.5 -> 0
    kill(gs, ctx);
    expect(scores.some((s) => s.reason === 'skillshot')).toBe(false);
  });
});

describe('scoring: tidy bonus', () => {
  it('8. accrues only while all meters are green, throttled to ~1/s, and resumes after', () => {
    const { ctx, gs, scores } = setup();
    updateScoring(gs, 0.5, ctx); // timer 0.5 < 1 -> no flush yet
    expect(scores.filter((s) => s.reason === 'tidy')).toHaveLength(0);
    updateScoring(gs, 0.5, ctx); // timer 1.0 -> flush floor(5*1) = 5
    expect(scores.filter((s) => s.reason === 'tidy')).toEqual([{ delta: 5, total: 5, reason: 'tidy' }]);

    gs.meters.values.vice = 100; // a meter leaves green
    const accumBefore = gs.scoring.tidyAccumulator;
    updateScoring(gs, 1, ctx);
    expect(gs.scoring.tidyAccumulator).toBe(accumBefore); // no accrual while not green

    gs.meters.values.vice = 0; // back to green -> resumes
    updateScoring(gs, 1, ctx);
    expect(scores.filter((s) => s.reason === 'tidy')).toHaveLength(2);
  });
});

describe('scoring: incident survival', () => {
  it('9. a survived incident awards the per-id bonus (else default); a lost/mismatched one does not', () => {
    const { ctx, gs, scores } = setup();
    onIncidentStart(gs, { id: 'swarm' });
    onIncidentEnd(gs, { id: 'swarm', survived: true }, ctx);
    expect(scores.at(-1)).toMatchObject({ delta: 1500, reason: 'incident-survived' }); // per-id

    onIncidentStart(gs, { id: 'blackout' });
    onIncidentEnd(gs, { id: 'blackout', survived: false }, ctx); // not survived
    expect(scores.filter((s) => s.reason === 'incident-survived')).toHaveLength(1);

    onIncidentStart(gs, { id: 'pipe_failure' });
    onIncidentEnd(gs, { id: 'something_else', survived: true }, ctx); // mismatch
    expect(scores.filter((s) => s.reason === 'incident-survived')).toHaveLength(1);
  });

  it('falls back to the default survival bonus for an unlisted incident', () => {
    const { ctx, gs, scores } = setup();
    onIncidentStart(gs, { id: 'resident_party' });
    onIncidentEnd(gs, { id: 'resident_party', survived: true }, ctx);
    expect(scores.at(-1)?.delta).toBe(1000); // default
  });
});

describe('scoring: emission discipline & wiring', () => {
  it('10. score always equals the sum of emitted scoreChanged deltas, each with a reason', () => {
    const { ctx, gs, scores } = setup();
    for (let i = 0; i < 6; i++) kill(gs, ctx);
    onWaveStarted(gs, ctx);
    kill(gs, ctx);
    const sum = scores.reduce((acc, s) => acc + s.delta, 0);
    expect(gs.scoring.score).toBe(sum);
    expect(scores.every((s) => typeof s.reason === 'string' && s.reason.length > 0)).toBe(true);
    expect(scores.at(-1)?.total).toBe(gs.scoring.score);
  });

  it('registerScoring wires the bus so emitted events drive the state', () => {
    const { ctx, gs } = setup();
    const off = registerScoring(gs, ctx);
    ctx.events.emit('droneDestroyed', { id: 1, kind: 'scout', byPlayer: true, pos: { x: 0, y: 0 } });
    expect(gs.scoring.comboCount).toBe(1);
    ctx.events.emit('droneEscaped', { id: 1, damage: 1 });
    expect(gs.scoring.comboCount).toBe(0);
    off();
    ctx.events.emit('droneDestroyed', { id: 2, kind: 'scout', byPlayer: true, pos: { x: 0, y: 0 } });
    expect(gs.scoring.comboCount).toBe(0); // unsubscribed
  });

  it('optional combo decay lowers combo after the configured idle time', () => {
    const { ctx, gs } = setup({ comboDecaySeconds: 3 });
    for (let i = 0; i < 4; i++) kill(gs, ctx);
    expect(gs.scoring.comboCount).toBe(4);
    updateScoring(gs, 3, ctx);
    expect(gs.scoring.comboCount).toBe(0);
  });

  it('createScoringState starts neutral', () => {
    expect(createScoringState()).toMatchObject({ score: 0, comboCount: 0, multiplier: 1, bonusModeFactor: 1 });
  });
});
