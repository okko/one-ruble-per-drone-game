// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { createHighscoreEntryScene, PICKER, PICKER_CELLS } from './entry-scene';
import type { HighscoreEntryParams } from './entry-scene';
import type { SceneManager } from '../../state/scene-manager';
import type { SystemContext } from '../../core/system-context';
import type { HighscoresRepo } from '../../persistence/highscores-repo';
import type { HighscoreEntry } from '../../persistence/schemas';

const ctx = {} as unknown as SystemContext;
const ISO = '2026-06-22T12:00:00.000Z';
const PARAMS: HighscoreEntryParams = {
  score: 5000,
  rank: 3,
  runSummary: { score: 5000, shiftSeconds: 120, dronesDowned: 50, cause: 'EXHAUSTION' },
};

function cellCenter(i: number): { x: number; y: number } {
  const col = i % PICKER.cols;
  const row = Math.floor(i / PICKER.cols);
  return { x: PICKER.originX + col * PICKER.cellW + PICKER.cellW / 2, y: PICKER.originY + row * PICKER.cellH + PICKER.cellH / 2 };
}
const DEL = PICKER_CELLS.indexOf('DEL');
const END = PICKER_CELLS.indexOf('END');

function make() {
  const add = vi.fn(() => ({ rank: 3 }));
  const repo = { list: () => [], qualifies: () => true, rankFor: () => 3, add, clear: vi.fn() } as unknown as HighscoresRepo;
  const transition = vi.fn();
  const mgr = { transition } as unknown as SceneManager;
  const scene = createHighscoreEntryScene({ sceneManager: mgr, repo, now: () => ISO });
  scene.enter(PARAMS, ctx);
  return { scene, add, transition };
}

function expectedEntry(name: string): HighscoreEntry {
  return { name, score: 5000, shiftSeconds: 120, dronesDowned: 50, dateISO: ISO, notable: 'EXHAUSTION' };
}

describe('HighscoreEntry scene', () => {
  it('keyboard path: typed name + Enter saves once and routes to the list highlighted', () => {
    const { scene, add, transition } = make();
    for (const code of ['KeyA', 'KeyB', 'KeyC']) scene.onInput({ type: 'key', code, down: true });
    expect(scene.name).toBe('ABC');
    scene.onInput({ type: 'key', code: 'Enter', down: true });
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(expectedEntry('ABC'));
    expect(transition).toHaveBeenCalledWith('Highscores', { highlightRank: 3 });
  });

  it('character-picker path (touch taps): builds the name, DEL + END work — no physical keyboard', () => {
    const { scene, add } = make();
    const tap = (i: number): void => scene.onInput({ type: 'pointer', world: cellCenter(i), down: true });
    tap(PICKER_CELLS.indexOf('A'));
    expect(scene.name).toBe('A');
    tap(PICKER_CELLS.indexOf('B'));
    expect(scene.name).toBe('AB');
    tap(DEL);
    expect(scene.name).toBe('A');
    tap(END);
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(expectedEntry('A'));
  });

  it('d-pad path: arrows move the cursor and fire activates the cell', () => {
    const { scene, add } = make();
    expect(scene.cursor).toBe(0);
    scene.onInput({ type: 'key', code: 'ArrowRight', down: true });
    expect(scene.cursor).toBe(1);
    scene.onInput({ type: 'key', code: 'ArrowLeft', down: true });
    expect(scene.cursor).toBe(0);
    scene.onInput({ type: 'key', code: 'ArrowDown', down: true });
    expect(scene.cursor).toBe(PICKER.cols); // one row down, same column
    scene.onInput({ type: 'fireDown' });
    expect(scene.name).toBe(PICKER_CELLS[PICKER.cols]); // the glyph under the cursor
    scene.onInput({ type: 'key', code: 'Enter', down: true });
    expect(add).toHaveBeenCalledWith(expectedEntry(PICKER_CELLS[PICKER.cols] as string));
  });

  it('an empty name falls back to the AAA placeholder on confirm', () => {
    const { scene, add } = make();
    scene.onInput({ type: 'pointer', world: cellCenter(END), down: true });
    expect(add).toHaveBeenCalledWith(expectedEntry('AAA'));
  });
});
