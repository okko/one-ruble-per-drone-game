/**
 * Content loader (docs/areas/00-core-platform.md §3.11). Loads typed data tables from raw input
 * (e.g. imported JSON), runs each domain validator, and FAILS LOUDLY at boot on malformed data
 * — never silently. The validated `Content` aggregate is exposed via SystemContext. Each domain
 * area (drones, residents, incidents, balance) adds its table + validator here as it lands; in
 * Phase 1 the only table is the art asset manifest.
 */
import { validateAssetManifest } from './assets-validate';
import { ContentValidationError } from './content-error';
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
import type { AssetManifest } from './assets';
import type { MeterBalance } from './meters';
import type { ResidentDef, EconomyTunables } from './residents';
import type { ScoringBalance } from './scoring';
import type { IncidentDef, SchedulerTunables } from './incidents';
import type { DroneDef } from './drones';
import type { CombatBalance } from './balance';

export interface Content {
  manifest: AssetManifest;
  meters: MeterBalance; // area 02 balance table
  economy: { roster: ResidentDef[]; tunables: EconomyTunables }; // area 03
  scoring: ScoringBalance; // area 04
  incidents: { catalog: IncidentDef[]; scheduler: SchedulerTunables }; // area 05
  drones: DroneDef[]; // area 01 catalog
  combat: CombatBalance; // area 01 spawn/gun/scaling tunables
}

export function loadContent(raw: unknown): Content {
  if (typeof raw !== 'object' || raw === null) {
    throw new ContentValidationError('expected an object', 'content');
  }
  const manifest = validateAssetManifest((raw as { manifest?: unknown }).manifest);
  // Static TS balance tables are imported and validated here (only the manifest comes via `raw`).
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
  return { manifest, meters, economy, scoring, incidents, drones, combat };
}
