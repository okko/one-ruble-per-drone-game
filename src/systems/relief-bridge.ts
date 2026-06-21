/**
 * Relief bridge (plan D3) — the composition glue between Economy and Meters, and the ONLY module
 * permitted to import both areas' value modules (each area is forbidden from importing the other).
 * It implements Economy's `ReliefSink` over a concrete `MetersState`: the roster-authored raw
 * {meter, amount, secondary} deltas are authoritative, and the neutral `effect` marker routes the
 * timed side effects (drunk / coffee) to the Meters area so they keep their balance-table semantics.
 * Conceptually owned by the integration/Engine layer; lives here so Phase 2 can test it end-to-end.
 */
import { applyRawRelief, setDrunk, setCoffee } from './meters';
import type { SystemContext } from '../core/system-context';
import type { MetersState } from '../state/game-state';
import type { ReliefSink } from './economy';

export function createReliefSink(m: MetersState, ctx: SystemContext): ReliefSink {
  return (req, qualityFactor = 1) => {
    applyRawRelief(m, req.meter, req.amount * qualityFactor, ctx); // primary relief, quality-scaled
    if (req.secondary) {
      // secondary.amount is a signed VALUE delta: positive worsens (raise), negative relieves (lower).
      // Not quality-scaled — a degraded favor's side effect shouldn't shrink as relationship drops.
      applyRawRelief(m, req.secondary.meter, -req.secondary.amount, ctx);
    }
    if (req.effect === 'drunk') setDrunk(m, ctx, qualityFactor);
    if (req.effect === 'coffee') setCoffee(m, ctx);
  };
}
