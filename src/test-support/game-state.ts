/**
 * Test-only `GameState` factory. Assembles a full state from the area slice factories with all-clear
 * incident flags, so cross-slice systems (scoring's tidy bonus, the update-ordering integration
 * tests) can run before the Engine/area-01 exists. Lives in test-support (excluded from coverage).
 */
import { createMetersState } from '../systems/meters';
import { createScoringState } from '../systems/scoring';
import { createEconomyState } from '../systems/economy';
import { createCombatState } from '../systems/combat/combat';
import type { GameState, IncidentsState } from '../state/game-state';
import type { Content } from '../content/loader';

const ALL_CLEAR_FLAGS: IncidentsState['flags'] = {
  toiletBlocked: false,
  spawnRateMultiplier: 1,
  bossActive: false,
  gunJammed: false,
  blackout: 0,
  sleepGainMultiplier: 1,
  servicePriceMultiplier: 1,
  servicesDisabled: false,
  inputLocked: false,
  decoysActive: false,
};

export function makeTestGameState(content: Content, over: Partial<GameState> = {}): GameState {
  return {
    time: { shiftSeconds: 0, phase: 'day', difficulty: 0 },
    player: { rubles: 0, debt: 0, reputation: 0 },
    meters: createMetersState(),
    combat: createCombatState(content),
    scoring: createScoringState(),
    economy: createEconomyState(content),
    incidents: { active: [], nextIn: 0, cooldowns: {}, globalCooldown: 0, flags: { ...ALL_CLEAR_FLAGS } },
    rng: { seed: 1 },
    flags: {},
    ...over,
  };
}
