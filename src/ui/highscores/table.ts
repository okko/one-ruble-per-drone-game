/**
 * Highscore table — PURE logic (docs/areas/08-highscores.md §3/§4). No I/O, no clock, no DOM: the
 * comparator, sort, qualification, insertion, and name validation that both the Persistence repo
 * (which delegates to these per area 08 §6) and the Highscores scenes share. `HighscoreEntry` is
 * imported from the single source of truth in `persistence/schemas`, never redeclared.
 *
 * Total-order comparator (§3.2): score↓ → shiftSeconds↓ → dronesDowned↓ → earlier `dateISO`.
 */
import { HIGHSCORES_MAX, MAX_NAME_LEN, type HighscoreEntry } from '../../persistence/schemas';
import { NAME_GLYPHS, PLACEHOLDER_NAME } from '../../content/highscores.glyphs';

/** Top-N cap kept on the board (§3.1). Aliases the schema's canonical `HIGHSCORES_MAX`. */
export const HIGHSCORE_CAP = HIGHSCORES_MAX;
export const MIN_NAME_LEN = 1;
export { MAX_NAME_LEN };

/** Deterministic, antisymmetric, transitive total order (§3.2). */
export function compareEntries(a: HighscoreEntry, b: HighscoreEntry): number {
  if (b.score !== a.score) return b.score - a.score;
  if (b.shiftSeconds !== a.shiftSeconds) return b.shiftSeconds - a.shiftSeconds;
  if (b.dronesDowned !== a.dronesDowned) return b.dronesDowned - a.dronesDowned;
  return a.dateISO.localeCompare(b.dateISO); // older run keeps the higher rank on a full tie
}

/** Sort a copy descending and trim to the top-N (§8.7). */
export function sortTable(entries: readonly HighscoreEntry[]): HighscoreEntry[] {
  return [...entries].sort(compareEntries).slice(0, HIGHSCORE_CAP);
}

/**
 * Does `finalScore` make the table? True when the table is not yet full, or strictly greater than
 * the lowest entry currently on it (§3.3). Equal scores only get in while the table has room.
 */
export function qualifies(finalScore: number, table: readonly HighscoreEntry[]): boolean {
  const sorted = [...table].sort(compareEntries);
  if (sorted.length < HIGHSCORE_CAP) return true;
  const lowest = sorted[HIGHSCORE_CAP - 1];
  return lowest === undefined || finalScore > lowest.score;
}

/**
 * Insert `entry` at its sorted position and trim to the cap (§3.5). Returns the new table and the
 * 1-based rank the entry landed at, or `rank: null` (table unchanged at the cap) if it fell off.
 */
export function insertEntry(
  table: readonly HighscoreEntry[],
  entry: HighscoreEntry,
): { table: HighscoreEntry[]; rank: number | null } {
  const combined = [...table, entry].sort(compareEntries);
  const idx = combined.indexOf(entry); // reference identity: the entry appears exactly once
  const capped = combined.slice(0, HIGHSCORE_CAP);
  if (idx >= 0 && idx < HIGHSCORE_CAP) return { table: capped, rank: idx + 1 };
  return { table: capped, rank: null };
}

/**
 * Clamp/sanitize a raw name to the allowed glyph set (§3.6): uppercase, keep only allowed glyphs,
 * cap to `MAX_NAME_LEN`, trim trailing spaces; empty/whitespace-only falls back to the placeholder.
 */
export function validateName(raw: string): string {
  const allowed = new Set(NAME_GLYPHS);
  const filtered = [...raw.toUpperCase()].filter((c) => allowed.has(c)).join('');
  const clamped = filtered.slice(0, MAX_NAME_LEN);
  const trimmed = clamped.replace(/\s+$/u, '');
  return trimmed.length >= MIN_NAME_LEN ? trimmed : PLACEHOLDER_NAME;
}
