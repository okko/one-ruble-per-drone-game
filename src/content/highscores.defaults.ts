/**
 * Seed highscore table for a fresh install (docs/areas/08-highscores.md §3.8/§5). DATA: 10 entries,
 * already sorted descending by the §3.2 comparator (strictly descending scores), so the board is
 * never empty and new players have something to beat. Cheerful-but-grim names that punch at the
 * war machine / brass, never at ordinary people (docs/compliance.md §2/§5). `notable` is short
 * flavor; `dateISO` is fixed (no clock in data).
 */
import type { HighscoreEntry } from '../persistence/schemas';

export const DEFAULT_TABLE: HighscoreEntry[] = [
  { name: 'THE BRASS', score: 12500, shiftSeconds: 540, dronesDowned: 210, dateISO: '2026-01-02T09:00:00.000Z', notable: 'Promoted posthumously' },
  { name: 'DESK GENERAL', score: 9800, shiftSeconds: 480, dronesDowned: 176, dateISO: '2026-01-05T09:00:00.000Z', notable: 'Never left the bunker' },
  { name: 'MEDAL HUNTER', score: 7600, shiftSeconds: 430, dronesDowned: 150, dateISO: '2026-01-09T09:00:00.000Z', notable: 'Pension pending' },
  { name: 'QUOTA QUEEN', score: 5400, shiftSeconds: 360, dronesDowned: 128, dateISO: '2026-01-14T09:00:00.000Z', notable: 'Hit every target' },
  { name: 'BUNKER BOSS', score: 4200, shiftSeconds: 300, dronesDowned: 99, dateISO: '2026-01-19T09:00:00.000Z', notable: 'Lost the keys' },
  { name: 'RATION KING', score: 3100, shiftSeconds: 255, dronesDowned: 77, dateISO: '2026-01-23T09:00:00.000Z', notable: 'Two squares a day' },
  { name: 'FIVE YR PLAN', score: 2300, shiftSeconds: 210, dronesDowned: 60, dateISO: '2026-01-28T09:00:00.000Z', notable: 'Ahead of schedule' },
  { name: 'NIGHT SHIFT', score: 1500, shiftSeconds: 165, dronesDowned: 41, dateISO: '2026-02-02T09:00:00.000Z', notable: 'Saw the sunrise once' },
  { name: 'OLD COMRADE', score: 900, shiftSeconds: 120, dronesDowned: 25, dateISO: '2026-02-07T09:00:00.000Z', notable: 'Still owes rent' },
  { name: 'ROOKIE', score: 400, shiftSeconds: 75, dronesDowned: 12, dateISO: '2026-02-11T09:00:00.000Z', notable: 'First day jitters' },
];
