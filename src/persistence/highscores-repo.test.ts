import { describe, it, expect } from 'vitest';
import { createStorage, createMemoryBackend } from './storage';
import { createHighscoresRepo } from './highscores-repo';
import { HIGHSCORES_MAX, type HighscoreEntry } from './schemas';
import { DEFAULT_TABLE } from '../content/highscores.defaults';

const HIGHEST = Math.max(...DEFAULT_TABLE.map((e) => e.score));
const LOWEST = Math.min(...DEFAULT_TABLE.map((e) => e.score));

function entry(score: number, over: Partial<HighscoreEntry> = {}): HighscoreEntry {
  return {
    name: 'AAA',
    score,
    shiftSeconds: 60,
    dronesDowned: 10,
    dateISO: '2026-06-21T00:00:00.000Z',
    ...over,
  };
}

function fresh() {
  return createHighscoresRepo(createStorage(createMemoryBackend()));
}

describe('HighscoresRepo', () => {
  it('seeds DEFAULT_TABLE on a fresh install (never an empty board)', () => {
    const repo = fresh();
    const list = repo.list();
    expect(list.length).toBe(HIGHSCORES_MAX);
    expect(list).toEqual(DEFAULT_TABLE); // already sorted descending
  });

  it('falls back to the seed when the stored data is corrupt', () => {
    const backend = createMemoryBackend();
    backend.setItem('orpd:highscores', JSON.stringify({ version: 1, data: [{ junk: true }, 5] }));
    const repo = createHighscoresRepo(createStorage(backend));
    expect(repo.list()).toEqual(DEFAULT_TABLE);
  });

  it('keeps the list sorted descending and capped at MAX', () => {
    const repo = fresh();
    for (let i = 0; i < HIGHSCORES_MAX + 5; i++) repo.add(entry(HIGHEST + (i + 1) * 100));
    const list = repo.list();
    expect(list.length).toBe(HIGHSCORES_MAX);
    const scores = list.map((e) => e.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(scores[0]).toBe(HIGHEST + (HIGHSCORES_MAX + 5) * 100); // highest survived
  });

  it('add returns the 1-based rank, or MAX+1 when it does not place', () => {
    const repo = fresh();
    expect(repo.add(entry(HIGHEST + 100)).rank).toBe(1); // new best beats every seed
    expect(repo.add(entry(HIGHEST + 200)).rank).toBe(1); // newer best
    expect(repo.add(entry(HIGHEST + 150)).rank).toBe(2);
    expect(repo.add(entry(LOWEST - 1)).rank).toBe(HIGHSCORES_MAX + 1); // below the lowest seed
  });

  describe('qualifies / rankFor around the seeded cap boundary', () => {
    it('with a full seeded board, qualifies only scores strictly above the lowest', () => {
      const repo = fresh();
      expect(repo.qualifies(LOWEST + 1)).toBe(true);
      expect(repo.qualifies(LOWEST)).toBe(false); // equal to lowest does not qualify
      expect(repo.qualifies(LOWEST - 50)).toBe(false);
      expect(repo.rankFor(LOWEST - 50)).toBe(HIGHSCORES_MAX + 1);
      expect(repo.rankFor(HIGHEST + 1)).toBe(1);
    });
  });

  it('resets to the seed table on clear', () => {
    const repo = createHighscoresRepo(createStorage(createMemoryBackend()));
    repo.add(entry(HIGHEST + 1000));
    repo.clear();
    expect(repo.list()).toEqual(DEFAULT_TABLE);
  });

  it('persists a qualifying entry across repo instances over the same backend', () => {
    const backend = createMemoryBackend();
    createHighscoresRepo(createStorage(backend)).add(entry(HIGHEST + 500, { name: 'WIN' }));
    const reloaded = createHighscoresRepo(createStorage(backend)).list();
    expect(reloaded[0]?.score).toBe(HIGHEST + 500);
    expect(reloaded[0]?.name).toBe('WIN');
  });
});
