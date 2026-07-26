// The list screen is DOM, and the row contents are the thing worth asserting, so this drives the
// scene through a real shell into a real document rather than inspecting a view-model.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHighscoresListScene } from './list-scene';
import { createUiShell, type UiShell } from '../shell/ui-shell';
import { createHighscoresRepo } from '../../persistence/highscores-repo';
import { createStorage, createMemoryBackend } from '../../persistence/storage';
import { DEFAULT_TABLE } from '../../content/highscores.defaults';
import { groupThousands, mmss, shortDate } from '../format';
import type { SceneManager } from '../../state/scene-manager';
import type { SystemContext } from '../../core/system-context';

const ctx = {} as unknown as SystemContext;

let root: HTMLElement;
let shell: UiShell;

beforeEach(() => {
  root = document.createElement('div');
  document.body.append(root);
  shell = createUiShell(root);
});

afterEach(() => {
  shell.dispose();
  root.remove();
});

function fakeManager(): { mgr: SceneManager; transition: ReturnType<typeof vi.fn> } {
  const transition = vi.fn();
  return { mgr: { transition } as unknown as SceneManager, transition };
}

function repo() {
  return createHighscoresRepo(createStorage(createMemoryBackend())); // fresh → seeded DEFAULT_TABLE
}

function make(params: { highlightRank?: number } = {}) {
  const { mgr, transition } = fakeManager();
  const scene = createHighscoresListScene({ sceneManager: mgr, repo: repo(), shell });
  scene.enter(params, ctx);
  scene.render(0);
  return { scene, transition };
}

describe('Highscores list scene', () => {
  it('shows all N rows with rank/name/score/shift/date/notable fields', () => {
    make();
    const rows = [...root.querySelectorAll('tbody tr')];
    expect(rows).toHaveLength(DEFAULT_TABLE.length);
    DEFAULT_TABLE.forEach((e, i) => {
      const cells = [...(rows[i]?.querySelectorAll('td') ?? [])].map((c) => c.textContent);
      expect(cells).toContain(String(i + 1));
      expect(cells).toContain(e.name);
      expect(cells).toContain(groupThousands(e.score));
      expect(cells).toContain(mmss(e.shiftSeconds));
      expect(cells).toContain(shortDate(e.dateISO));
      if (e.notable) expect(cells).toContain(e.notable);
    });
  });

  it('marks exactly the highlighted row, and none when unhighlighted', () => {
    make({ highlightRank: 3 });
    const marked = root.querySelectorAll('tbody tr[aria-current="true"]');
    expect(marked).toHaveLength(1);
    expect(marked[0]?.querySelector('td')?.textContent).toBe('3');

    shell.hide('highscores');
    make();
    expect(root.querySelectorAll('tbody tr[aria-current="true"]')).toHaveLength(0);
  });

  it('writes a player-supplied name as text, never as markup', () => {
    const { mgr } = fakeManager();
    const r = repo();
    r.add({
      name: '<img src=x onerror=1>',
      score: 999999,
      shiftSeconds: 1,
      dronesDowned: 0,
      dateISO: '2026-01-01T00:00:00.000Z',
    });
    const scene = createHighscoresListScene({ sceneManager: mgr, repo: r, shell });
    scene.enter({}, ctx);
    scene.render(0);
    expect(root.querySelector('img')).toBeNull();
    expect(root.textContent).toContain('<img src=x onerror=1>');
  });

  it('returns to the Main Menu on back and takes its screen with it', () => {
    const { mgr, transition } = fakeManager();
    const scene = createHighscoresListScene({ sceneManager: mgr, repo: repo(), shell });
    scene.enter({}, ctx);
    expect(shell.get('highscores')).toBeDefined();
    scene.onInput({ type: 'key', code: 'Enter', down: true });
    expect(transition).toHaveBeenCalledWith('MainMenu');
    scene.exit();
    expect(shell.get('highscores')).toBeUndefined();
  });
});
