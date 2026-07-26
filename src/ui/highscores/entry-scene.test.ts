// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { createHighscoreEntryScene, PICKER_COLS, PICKER_CELLS } from './entry-scene';
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

const DEL = PICKER_CELLS.indexOf('DEL');
const END = PICKER_CELLS.indexOf('END');

/** Drive the cursor to a cell the way the d-pad does — the input method with no keyboard. */
function pick(scene: ReturnType<typeof createHighscoreEntryScene>, index: number): void {
  const row = Math.floor(index / PICKER_COLS);
  const col = index % PICKER_COLS;
  while (Math.floor(scene.cursor / PICKER_COLS) !== row) {
    scene.onInput({ type: 'key', code: 'ArrowDown', down: true });
  }
  while (scene.cursor % PICKER_COLS !== col) {
    scene.onInput({ type: 'key', code: 'ArrowRight', down: true });
  }
}

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

  it('cursor path: moving to a cell and firing builds the name; DEL and END work', () => {
    const { scene, add } = make();
    const fire = (): void => scene.onInput({ type: 'fireDown' });
    pick(scene, PICKER_CELLS.indexOf('A'));
    fire();
    expect(scene.name).toBe('A');
    pick(scene, PICKER_CELLS.indexOf('B'));
    fire();
    expect(scene.name).toBe('AB');
    pick(scene, DEL);
    fire();
    expect(scene.name).toBe('A');
    pick(scene, END);
    fire();
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(expectedEntry('A'));
  });

  it('ignores raw pointer events: taps are DOM clicks on the picker cells, never hit-tests', () => {
    const { scene, add } = make();
    scene.onInput({ type: 'pointer', world: { x: 10, y: 10 }, down: true });
    scene.onInput({ type: 'aim', world: { x: 10, y: 10 } });
    expect(scene.name).toBe('');
    expect(add).not.toHaveBeenCalled();
  });

  it('d-pad path: arrows move the cursor and fire activates the cell', () => {
    const { scene, add } = make();
    expect(scene.cursor).toBe(0);
    scene.onInput({ type: 'key', code: 'ArrowRight', down: true });
    expect(scene.cursor).toBe(1);
    scene.onInput({ type: 'key', code: 'ArrowLeft', down: true });
    expect(scene.cursor).toBe(0);
    scene.onInput({ type: 'key', code: 'ArrowDown', down: true });
    expect(scene.cursor).toBe(PICKER_COLS); // one row down, same column
    scene.onInput({ type: 'fireDown' });
    expect(scene.name).toBe(PICKER_CELLS[PICKER_COLS]); // the glyph under the cursor
    scene.onInput({ type: 'key', code: 'Enter', down: true });
    expect(add).toHaveBeenCalledWith(expectedEntry(PICKER_CELLS[PICKER_COLS] as string));
  });

  it('an empty name falls back to the AAA placeholder on confirm', () => {
    const { scene, add } = make();
    pick(scene, END);
    scene.onInput({ type: 'fireDown' });
    expect(add).toHaveBeenCalledWith(expectedEntry('AAA'));
  });
});
