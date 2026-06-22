// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { createHighscoresListScene } from './list-scene';
import { createRecordingRenderer } from '../../test-support/recording-renderer';
import { createHighscoresRepo } from '../../persistence/highscores-repo';
import { createStorage, createMemoryBackend } from '../../persistence/storage';
import { DEFAULT_TABLE } from '../../content/highscores.defaults';
import { groupThousands, mmss, shortDate } from '../format';
import type { SceneManager } from '../../state/scene-manager';
import type { SystemContext } from '../../core/system-context';

const ctx = {} as unknown as SystemContext;

function fakeManager(): { mgr: SceneManager; transition: ReturnType<typeof vi.fn> } {
  const transition = vi.fn();
  return { mgr: { transition } as unknown as SceneManager, transition };
}

function repo() {
  return createHighscoresRepo(createStorage(createMemoryBackend())); // fresh → seeded DEFAULT_TABLE
}

describe('Highscores list scene', () => {
  it('renders all N rows with rank/name/score/shift/date/notable fields', () => {
    const { mgr } = fakeManager();
    const scene = createHighscoresListScene({ sceneManager: mgr, repo: repo() });
    const r = createRecordingRenderer();
    scene.enter({}, ctx);
    scene.render(r);
    for (const e of DEFAULT_TABLE) {
      expect(r.textsContaining(e.name).length).toBeGreaterThan(0);
      expect(r.textsContaining(groupThousands(e.score)).length).toBeGreaterThan(0);
      expect(r.textsContaining(mmss(e.shiftSeconds)).length).toBeGreaterThan(0);
      expect(r.textsContaining(shortDate(e.dateISO)).length).toBeGreaterThan(0);
      if (e.notable) expect(r.textsContaining(e.notable).length).toBeGreaterThan(0);
    }
  });

  it('marks exactly the highlighted row, and none when unhighlighted', () => {
    const { mgr } = fakeManager();
    const hi = createHighscoresListScene({ sceneManager: mgr, repo: repo() });
    const r1 = createRecordingRenderer();
    hi.enter({ highlightRank: 3 }, ctx);
    hi.render(r1);
    expect(r1.rectsOfColor('panelLite').length).toBe(1);

    const plain = createHighscoresListScene({ sceneManager: mgr, repo: repo() });
    const r2 = createRecordingRenderer();
    plain.enter({}, ctx);
    plain.render(r2);
    expect(r2.rectsOfColor('panelLite').length).toBe(0);
  });

  it('returns to the Main Menu on back', () => {
    const { mgr, transition } = fakeManager();
    const scene = createHighscoresListScene({ sceneManager: mgr, repo: repo() });
    scene.enter({}, ctx);
    scene.onInput({ type: 'key', code: 'Enter', down: true });
    expect(transition).toHaveBeenCalledWith('MainMenu');
  });
});
