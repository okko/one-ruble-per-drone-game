/**
 * Assembles a fresh `GameState` from the per-area slice factories (Phase 2). Lives apart from
 * `game-state.ts` (which holds only the slice TYPES and must stay free of `systems/` imports) so the
 * type module remains cycle-free: `create-game-state` → systems → `game-state`, never the reverse.
 * The Gameplay Engine (area 01) drives the per-tick update ordering over this state.
 */
import { createMetersState } from '../systems/meters';
import { createScoringState } from '../systems/scoring';
import { createEconomyState } from '../systems/economy';
import { createIncidentsState } from '../systems/incidents';
import { createCombatState } from '../systems/combat/combat';
import type { GameState } from './game-state';
import type { Content } from '../content/loader';

export function createGameState(content: Content, seed: number): GameState {
  return {
    time: { shiftSeconds: 0, phase: 'day', difficulty: 0 },
    player: { rubles: 0, debt: 0, reputation: 0 },
    meters: createMetersState(),
    combat: createCombatState(content),
    scoring: createScoringState(),
    economy: createEconomyState(content),
    incidents: createIncidentsState(content),
    rng: { seed },
    flags: {},
  };
}
