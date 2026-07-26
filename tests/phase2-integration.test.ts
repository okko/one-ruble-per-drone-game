/**
 * Cross-area integration for Phase 2 (docs/areas/02-05 §8 integration cases): the four pure gameplay
 * systems wired together over a real GameState + event bus. Proves the seams the unit tests mock:
 * incidents→meters (pipe block), incidents→scoring (survival bonus), economy→meters via the relief
 * bridge (incl. vodka→drunk), and the documented per-tick update ordering (Incidents → Meters /
 * Economy → Scoring). The Engine (area 01) will own the real loop; here we drive it explicitly.
 */
import { describe, it, expect } from 'vitest';
import { createRng } from '../src/core/rng';
import { createEventBus } from '../src/core/events';
import { loadContent } from '../src/content/loader';
import { createGameState } from '../src/state/create-game-state';
import { update as updateMeters, applyRelief, computeEffects } from '../src/systems/meters';
import type { MetersRead } from '../src/systems/meters';
import {
  handleDroneDestroyed,
  buyService,
  updateEconomy,
  applyIncidentFlags,
} from '../src/systems/economy';
import type { EconomyContext } from '../src/systems/economy';
import { createReliefSink } from '../src/systems/relief-bridge';
import { updateScoring, registerScoring } from '../src/systems/scoring';
import { updateIncidents } from '../src/systems/incidents';
import type { SystemContext } from '../src/core/system-context';
import type { GameState, IncidentsState } from '../src/state/game-state';
import type { IncidentDef, SchedulerTunables } from '../src/content/incidents';

function makeCtx(): SystemContext {
  return { rng: createRng(0x5eed), events: createEventBus(), content: loadContent() };
}

function forceActive(s: IncidentsState, id: string, ctx: SystemContext): void {
  const def = ctx.content.incidents.catalog.find((d) => d.id === id);
  if (!def) throw new Error(`no such incident ${id}`);
  s.active.push({ id, phase: 'active', phaseRemaining: def.durationSeconds, resolvable: def.resolution !== undefined });
  s.nextIn = 9999;
}

describe('phase 2 integration', () => {
  it('incidents → meters: pipe failure blocks the toilet, and relief works once it clears', () => {
    const ctx = makeCtx();
    const gs = createGameState(ctx.content, 1);
    gs.meters.values.poo = 90;

    forceActive(gs.incidents, 'pipe_failure', ctx);
    updateIncidents(gs.incidents, 0, ctx, 5);
    expect(gs.incidents.flags.toiletBlocked).toBe(true);

    const blocked = applyRelief(gs.meters, 'toilet', ctx, { pipeFailure: gs.incidents.flags.toiletBlocked });
    expect(blocked).toEqual({ applied: false, reason: 'pipe_failure' });
    expect(gs.meters.values.poo).toBe(90);

    updateIncidents(gs.incidents, 999, ctx, 5); // pipe failure times out
    expect(gs.incidents.flags.toiletBlocked).toBe(false);
    const ok = applyRelief(gs.meters, 'toilet', ctx, { pipeFailure: gs.incidents.flags.toiletBlocked });
    expect(ok.applied).toBe(true);
    expect(gs.meters.values.poo).toBeCloseTo(0, 5);
  });

  it('incidents → scoring: surviving an incident awards the survival bonus over the bus', () => {
    const fast: SchedulerTunables = {
      baseInterval: 5,
      minInterval: 2,
      rate: 0.1,
      postIncidentCooldown: 0,
      gracePeriod: 0,
      maxConcurrent: 1,
    };
    const one: IncidentDef = {
      id: 'tremor',
      name: 'A Little Rumble!',
      flavor: 'The building settles, loudly.',
      category: 'power',
      exclusive: false,
      minDifficulty: 0,
      weight: () => 1,
      telegraphSeconds: 2,
      durationSeconds: 2,
      cooldownSeconds: 999,
      apply: (f) => {
        f.blackout = Math.max(f.blackout, 0.3);
      },
    };
    const content = { ...loadContent(), incidents: { catalog: [one], scheduler: fast } };
    const ctx: SystemContext = { rng: createRng(7), events: createEventBus(), content };
    const gs = createGameState(content, 7);
    registerScoring(gs, ctx);

    let survived = false;
    ctx.events.on('incidentEnd', (p) => {
      survived ||= p.survived;
    });
    for (let i = 0; i < 60 && !survived; i++) updateIncidents(gs.incidents, 0.5, ctx, 0);
    expect(survived).toBe(true);
    // 'tremor' is not in the survival table → the default bonus (1000) is awarded.
    expect(gs.scoring.score).toBe(content.scoring.incidentSurvivalBonus.default);
  });

  it('economy → meters (relief bridge): five kills fund a vodka that produces the drunk debuff', () => {
    const ctx = makeCtx();
    const gs = createGameState(ctx.content, 1);
    const ectx: EconomyContext = { ...ctx, applyRelief: createReliefSink(gs.meters, ctx) };
    gs.meters.values.vice = 90;
    gs.meters.values.sleep = 50;

    for (let i = 0; i < 5; i++) gs.economy = handleDroneDestroyed(gs.economy, { byPlayer: true }, ctx);
    expect(gs.economy.rubles).toBe(5);

    const res = buyService(gs.economy, 'veteran', 'vodka', ectx); // 3 rubles
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    gs.economy = res.value;

    expect(gs.economy.rubles).toBe(2);
    expect(gs.meters.values.vice).toBeCloseTo(20, 5); // -70
    expect(gs.meters.values.sleep).toBeCloseTo(35, 5); // -15 via secondary
    expect(gs.meters.drunkTimer).toBeGreaterThan(0);
    expect(computeEffects(gs.meters, ctx.content.meters).drunk).toBe(true);
  });

  it('update ordering (Incidents → Meters/Economy → Scoring): meters & economy see this-tick flags', () => {
    const ctx = makeCtx();
    const gs = createGameState(ctx.content, 1);

    /** One tick in the documented order. */
    function tick(state: GameState, dt: number, D: number): void {
      updateIncidents(state.incidents, dt, ctx, D);
      const f = state.incidents.flags;
      state.economy = applyIncidentFlags(state.economy, f);
      const read: MetersRead = {
        phase: state.time.phase,
        difficulty: D,
        recentShotRate: 0,
        sleepGainMultiplier: f.sleepGainMultiplier,
        shiftSeconds: state.time.shiftSeconds,
        score: state.scoring.score,
        dronesDowned: 0,
      };
      updateMeters(state.meters, dt, ctx, read);
      state.economy = updateEconomy(state.economy, dt, ctx);
      updateScoring(state, dt, ctx);
    }

    // Control: a tick with no incidents.
    const control = createGameState(ctx.content, 1);
    tick(control, 1, 0);

    // With a blackout active, meters should see sleepGainMultiplier (1.5) in the SAME tick, and
    // economy should see a spiked price multiplier (supply shortage) it picked up this tick.
    forceActive(gs.incidents, 'blackout', ctx);
    forceActive(gs.incidents, 'supply_shortage', ctx);
    tick(gs, 1, 0);

    expect(gs.meters.values.sleep).toBeCloseTo(control.meters.values.sleep * 1.5, 5);
    expect(gs.economy.priceMultiplier).toBe(2);
    expect(gs.incidents.flags.blackout).toBe(0.7);
  });
});
