/**
 * The Gameplay Engine's master tick (docs/areas/01-gameplay-engine.md §1; create-game-state.ts header).
 * `createEngine` wires the event subscriptions a run needs and returns a pure `step(dt, intent)` that
 * advances every system in the documented order — Incidents → Meters/Economy → Combat → Scoring —
 * over a shared `GameState`. The scene wraps this; tests drive it directly (no Renderer/SceneManager).
 *
 * Two things only the engine can own, because they span systems:
 *  - a run-level gameOver LATCH (both Meters `collapse:*` and Combat `post-destroyed` emit gameOver —
 *    the latch stops the tick after the first so the global `wireGameOver` never double-fires);
 *  - the kind-aware ruble income (Economy banks +1 only when the destroyed drone awards a ruble, so a
 *    player-shot decoy earns nothing — `handleDroneDestroyed` alone would pay for it).
 */
import { updateIncidents } from '../incidents';
import { applyIncidentFlags, updateEconomy, bankIncome } from '../economy';
import { update as updateMeters, computeEffects } from '../meters';
import type { MetersRead } from '../meters';
import { updateScoring, registerScoring } from '../scoring';
import { difficultyAt, phaseAt } from '../../core/difficulty';
import type { SystemContext } from '../../core/system-context';
import type { GameState } from '../../state/game-state';
import { updateCombat, setJam } from './combat';
import { deriveAimModifier } from './gun';
import { IDLE_INTENT } from './types';
import type { PlayerIntent } from './types';

export interface Engine {
  /** Advance one fixed tick with the player's buffered input. No-op once the run is over. */
  step(dt: number, intent?: PlayerIntent): void;
  /** Detach all event subscriptions (call on scene exit). */
  dispose(): void;
}

export function createEngine(gs: GameState, ctx: SystemContext): Engine {
  // Seed the per-run aim-sway phase once (deterministic from the run seed).
  gs.combat.gun.swayPhase = ctx.rng.range(0, Math.PI * 2);

  const awardsRuble = new Map(ctx.content.drones.map((d) => [d.kind, d.awardsRuble]));
  let over = false;
  let prevGunJammed = false;

  const offScoring = registerScoring(gs, ctx);
  const offIncome = ctx.events.on('droneDestroyed', (p) => {
    if (p.byPlayer && (awardsRuble.get(p.kind) ?? false)) {
      gs.economy = bankIncome(gs.economy, 1, ctx);
    }
  });
  const offGameOver = ctx.events.on('gameOver', () => {
    over = true;
  });

  function step(dt: number, intent: PlayerIntent = IDLE_INTENT): void {
    if (over) return;
    const t = gs.time;

    // 0. Advance the shift clock; difficulty/phase are derived, never written by combat.
    t.shiftSeconds += dt;
    const ramp = ctx.content.combat.difficulty;
    t.difficulty = difficultyAt(t.shiftSeconds, ramp);
    t.phase = phaseAt(t.shiftSeconds, ramp);
    const D = t.difficulty;

    // 1. Incidents first, so everyone downstream sees this tick's flags.
    updateIncidents(gs.incidents, dt, ctx, D);
    const flags = gs.incidents.flags;

    // Incident-raised jam jams the gun once (rising edge); the player may still clear it early.
    if (flags.gunJammed && !prevGunJammed) setJam(gs.combat, true);
    prevGunJammed = flags.gunJammed;

    // 2. Economy mirrors incident flags (price/availability) this tick.
    gs.economy = applyIncidentFlags(gs.economy, flags);

    // 3. Meters drain (may emit a collapse gameOver → latch).
    const read: MetersRead = {
      phase: t.phase,
      difficulty: D,
      recentShotRate: gs.combat.gun.recentShotRate, // intentional 1-tick lag (combat updates it below)
      sleepGainMultiplier: flags.sleepGainMultiplier,
      shiftSeconds: t.shiftSeconds,
      score: gs.scoring.score,
      dronesDowned: gs.combat.dronesDowned,
    };
    updateMeters(gs.meters, dt, ctx, read);
    if (over) return; // a meter collapse ended the run; don't also run combat this tick

    // 4. Economy upkeep (chore countdown + drift).
    gs.economy = updateEconomy(gs.economy, dt, ctx);

    // 5. Combat: spawn/aim/fire/collide. Emits droneDestroyed (→ scoring + income, sync) / droneEscaped
    //    / gameOver(post-destroyed). Aim modifier is derived from the current meter effects.
    const aimMod = deriveAimModifier(computeEffects(gs.meters, ctx.content.meters), ctx.content.combat);
    updateCombat(gs.combat, dt, ctx, {
      D,
      aimMod,
      flags,
      intent,
      tSeconds: t.shiftSeconds,
      score: gs.scoring.score,
    });

    // 6. Scoring timers + tidy accrual (kills already scored synchronously above).
    updateScoring(gs, dt, ctx);
  }

  function dispose(): void {
    offScoring();
    offIncome();
    offGameOver();
  }

  return { step, dispose };
}
