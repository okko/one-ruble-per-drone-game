/**
 * Highscore table repository (docs/areas/09-state-and-persistence.md §4, docs/areas/08-highscores.md
 * §6). Owns the `localStorage` I/O only; the sort/qualify/insert logic is DELEGATED to the area-08
 * pure `ui/highscores/table.ts` (no duplicated comparator). A fresh/empty/corrupt store is SEEDED
 * with `DEFAULT_TABLE` on read, so the board is never empty and new players have something to beat
 * (§3.8); `clear()` resets to that seed. No storage access leaves this module.
 */
import type { Storage } from './storage';
import { KEY_HIGHSCORES, type HighscoreEntry } from './schemas';
import {
  HIGHSCORE_CAP,
  insertEntry,
  qualifies as qualifiesAgainst,
  sortTable,
} from '../ui/highscores/table';
import { DEFAULT_TABLE } from '../content/highscores.defaults';

export interface HighscoresRepo {
  list(): HighscoreEntry[];
  qualifies(score: number): boolean;
  rankFor(score: number): number; // 1-based, or HIGHSCORE_CAP + 1 if it wouldn't place
  add(entry: HighscoreEntry): { rank: number };
  clear(): void;
}

function isEntry(v: unknown): v is HighscoreEntry {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.name === 'string' &&
    typeof e.score === 'number' &&
    typeof e.shiftSeconds === 'number' &&
    typeof e.dronesDowned === 'number' &&
    typeof e.dateISO === 'string'
  );
}

export function createHighscoresRepo(storage: Storage): HighscoresRepo {
  // Read the persisted table, dropping corrupt rows; an empty result seeds the defaults so the
  // screen is never blank (area 08 §3.8). Always returned sorted + capped via the pure table logic.
  function read(): HighscoreEntry[] {
    const raw = storage.get<unknown>(KEY_HIGHSCORES, []);
    const valid = Array.isArray(raw) ? raw.filter(isEntry) : [];
    return sortTable(valid.length === 0 ? DEFAULT_TABLE : valid);
  }

  function qualifies(score: number): boolean {
    return qualifiesAgainst(score, read());
  }

  return {
    list: read,
    qualifies,
    rankFor(score: number): number {
      if (!qualifies(score)) return HIGHSCORE_CAP + 1;
      return read().filter((e) => e.score > score).length + 1;
    },
    add(entry: HighscoreEntry): { rank: number } {
      const { table, rank } = insertEntry(read(), entry);
      storage.set(KEY_HIGHSCORES, table);
      return { rank: rank ?? HIGHSCORE_CAP + 1 };
    },
    clear(): void {
      storage.remove(KEY_HIGHSCORES); // next read re-seeds DEFAULT_TABLE
    },
  };
}
