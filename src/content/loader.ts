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
import type { AssetManifest } from './assets';
import type { MeterBalance } from './meters';
import type { ResidentDef, EconomyTunables } from './residents';

export interface Content {
  manifest: AssetManifest;
  meters: MeterBalance; // area 02 balance table
  economy: { roster: ResidentDef[]; tunables: EconomyTunables }; // area 03
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
  return { manifest, meters, economy };
}
