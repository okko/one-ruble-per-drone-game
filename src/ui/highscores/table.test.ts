// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  compareEntries,
  sortTable,
  qualifies,
  insertEntry,
  validateName,
  HIGHSCORE_CAP,
} from './table';
import { DEFAULT_TABLE } from '../../content/highscores.defaults';
import type { HighscoreEntry } from '../../persistence/schemas';

function entry(score: number, over: Partial<HighscoreEntry> = {}): HighscoreEntry {
  return { name: 'AAA', score, shiftSeconds: 60, dronesDowned: 10, dateISO: '2026-06-21T00:00:00.000Z', ...over };
}

function table(n: number, base = 100): HighscoreEntry[] {
  return Array.from({ length: n }, (_, i) => entry(base + i, { name: `E${i}` }));
}

describe('highscores/table', () => {
  describe('compareEntries — total order', () => {
    it('orders by score, then shiftSeconds, dronesDowned, then earlier date', () => {
      expect(compareEntries(entry(200), entry(100))).toBeLessThan(0); // higher score first
      expect(compareEntries(entry(100, { shiftSeconds: 99 }), entry(100, { shiftSeconds: 10 }))).toBeLessThan(0);
      expect(compareEntries(entry(100, { dronesDowned: 9 }), entry(100, { dronesDowned: 2 }))).toBeLessThan(0);
      const earlier = entry(100, { dateISO: '2026-01-01T00:00:00.000Z' });
      const later = entry(100, { dateISO: '2026-09-01T00:00:00.000Z' });
      expect(compareEntries(earlier, later)).toBeLessThan(0); // older keeps the higher rank
    });

    it('is antisymmetric and transitive on a sample', () => {
      const a = entry(300);
      const b = entry(200);
      const c = entry(100);
      expect(Math.sign(compareEntries(a, b))).toBe(-Math.sign(compareEntries(b, a)));
      expect(compareEntries(a, b)).toBeLessThan(0);
      expect(compareEntries(b, c)).toBeLessThan(0);
      expect(compareEntries(a, c)).toBeLessThan(0); // transitivity
    });
  });

  it('sortTable sorts descending and caps at HIGHSCORE_CAP', () => {
    const unsorted = [entry(50), entry(900), entry(300), ...table(HIGHSCORE_CAP, 1000)];
    const sorted = sortTable(unsorted);
    expect(sorted.length).toBe(HIGHSCORE_CAP);
    const scores = sorted.map((e) => e.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  describe('qualifies', () => {
    it('any score qualifies while the table is under the cap (even 0)', () => {
      expect(qualifies(0, table(HIGHSCORE_CAP - 1))).toBe(true);
      expect(qualifies(0, [])).toBe(true);
    });
    it('on a full table, only scores strictly above the lowest qualify', () => {
      const full = table(HIGHSCORE_CAP, 100); // scores 100..109, lowest 100
      expect(qualifies(101, full)).toBe(true);
      expect(qualifies(100, full)).toBe(false); // equal to lowest
      expect(qualifies(99, full)).toBe(false);
    });
  });

  describe('insertEntry', () => {
    it('inserts a mid-value entry at its 1-based rank', () => {
      const t = [entry(300, { name: 'A' }), entry(100, { name: 'C' })];
      const { table: out, rank } = insertEntry(t, entry(200, { name: 'B' }));
      expect(rank).toBe(2);
      expect(out.map((e) => e.name)).toEqual(['A', 'B', 'C']);
    });
    it('into a full table drops the lowest', () => {
      const full = table(HIGHSCORE_CAP, 100); // 100..109
      const { table: out, rank } = insertEntry(full, entry(105, { name: 'NEW' }));
      expect(out.length).toBe(HIGHSCORE_CAP);
      expect(out.some((e) => e.score === 100)).toBe(false); // previous lowest gone
      expect(rank).not.toBeNull();
    });
    it('a non-qualifying insert returns rank null and leaves the table at the cap', () => {
      const full = table(HIGHSCORE_CAP, 100);
      const { table: out, rank } = insertEntry(full, entry(50, { name: 'LOW' }));
      expect(rank).toBeNull();
      expect(out.length).toBe(HIGHSCORE_CAP);
      expect(out.some((e) => e.name === 'LOW')).toBe(false);
    });
  });

  describe('validateName', () => {
    it('clamps over-length to MAX_NAME_LEN', () => {
      expect(validateName('TOOLONGNAME12345')).toBe('TOOLONGNAME1'); // 12 chars
    });
    it('uppercases and strips disallowed glyphs', () => {
      expect(validateName('a@b#c')).toBe('ABC');
    });
    it('trims trailing spaces', () => {
      expect(validateName('AB   ')).toBe('AB');
    });
    it('empty / whitespace-only falls back to the placeholder', () => {
      expect(validateName('')).toBe('AAA');
      expect(validateName('   ')).toBe('AAA');
      expect(validateName('@@@')).toBe('AAA');
    });
  });

  it('DEFAULT_TABLE has exactly the cap and is already sorted', () => {
    expect(DEFAULT_TABLE.length).toBe(HIGHSCORE_CAP);
    expect(sortTable(DEFAULT_TABLE)).toEqual(DEFAULT_TABLE);
  });
});
