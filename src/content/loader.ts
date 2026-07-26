/**
 * Content loader (docs/areas/00-core-platform.md §3.11). Runs every domain validator over the
 * typed data tables and FAILS LOUDLY at boot on malformed data — never silently. The validated
 * `Content` aggregate is exposed via SystemContext. Each domain area (drones, residents,
 * incidents, balance) adds its table + validator here as it lands.
 *
 * There is no raw input any more: the sprite-atlas manifest went out with the Canvas-2D pipeline,
 * so every table is a static TS module and the loader takes no arguments.
 */
import { validateMeterBalance } from './meters-validate';
import { meterBalance } from './meters';
import { validateResidents, validateEconomyTunables } from './residents-validate';
import { RESIDENTS, ECONOMY_TUNABLES } from './residents';
import { validateScoringBalance } from './scoring-validate';
import { scoringBalance } from './scoring';
import { validateIncidentCatalog, validateSchedulerTunables } from './incidents-validate';
import { INCIDENTS, schedulerTunables } from './incidents';
import { validateDrones } from './drones-validate';
import { DRONES } from './drones';
import { validateCombatBalance } from './balance-validate';
import { combatBalance } from './balance';
import { validateAudioContent } from './audio-validate';
import { audioContent } from './audio';
import type { AudioContent } from './audio';
import type { MeterBalance } from './meters';
import type { ResidentDef, EconomyTunables } from './residents';
import type { ScoringBalance } from './scoring';
import type { IncidentDef, SchedulerTunables } from './incidents';
import type { DroneDef } from './drones';
import type { CombatBalance } from './balance';

export interface Content {
  meters: MeterBalance; // area 02 balance table
  economy: { roster: ResidentDef[]; tunables: EconomyTunables }; // area 03
  scoring: ScoringBalance; // area 04
  incidents: { catalog: IncidentDef[]; scheduler: SchedulerTunables }; // area 05
  drones: DroneDef[]; // area 01 catalog
  combat: CombatBalance; // area 01 spawn/gun/scaling tunables
  audio: AudioContent; // area 06 SFX/music/ducking tables
}

export function loadContent(): Content {
  const meters = validateMeterBalance(meterBalance);
  const economy = {
    roster: validateResidents(RESIDENTS),
    tunables: validateEconomyTunables(ECONOMY_TUNABLES),
  };
  const scoring = validateScoringBalance(scoringBalance);
  const incidents = {
    catalog: validateIncidentCatalog(INCIDENTS),
    scheduler: validateSchedulerTunables(schedulerTunables),
  };
  const drones = validateDrones(DRONES);
  const combat = validateCombatBalance(combatBalance);
  const audio = validateAudioContent(audioContent);
  return { meters, economy, scoring, incidents, drones, combat, audio };
}
