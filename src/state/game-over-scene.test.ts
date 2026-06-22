// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { createGameOverScene } from './game-over-scene';
import type { SceneManager } from './scene-manager';
import type { SystemContext } from '../core/system-context';
import type { HighscoresRepo } from '../persistence/highscores-repo';
import type { MetaStatsRepo } from '../persistence/meta-stats-repo';
import { DEFAULT_META, type RunSummary } from '../persistence/schemas';

const ctx = {} as unknown as SystemContext;

function fakeManager(): { mgr: SceneManager; transition: ReturnType<typeof vi.fn> } {
  const transition = vi.fn();
  return { mgr: { transition } as unknown as SceneManager, transition };
}

function fakeRepo(q: boolean, rank: number): HighscoresRepo {
  return { list: () => [], qualifies: () => q, rankFor: () => rank, add: vi.fn(() => ({ rank })), clear: vi.fn() };
}

function fakeMeta(lastRun: RunSummary | null): MetaStatsRepo {
  const meta = { ...DEFAULT_META, lastRun };
  return { get: () => meta, recordRun: vi.fn(() => meta), markIntroSeen: vi.fn() };
}

const RUN: RunSummary = { score: 5000, shiftSeconds: 120, dronesDowned: 50, cause: 'EXHAUSTION' };

describe('GameOver scene', () => {
  it('routes a qualifying score to HighscoreEntry with rank + run summary', () => {
    const { mgr, transition } = fakeManager();
    const scene = createGameOverScene({ sceneManager: mgr, repo: fakeRepo(true, 4), meta: fakeMeta(RUN) });
    scene.enter({ score: 5000, cause: 'EXHAUSTION' }, ctx);
    scene.update(0.5, ctx); // arm input
    scene.onInput({ type: 'key', code: 'Enter', down: true });
    expect(transition).toHaveBeenCalledTimes(1);
    expect(transition).toHaveBeenCalledWith('HighscoreEntry', { score: 5000, rank: 4, runSummary: RUN });
  });

  it('routes a non-qualifying score straight to the Highscores list (no highlight)', () => {
    const { mgr, transition } = fakeManager();
    const scene = createGameOverScene({ sceneManager: mgr, repo: fakeRepo(false, 11), meta: fakeMeta(RUN) });
    scene.enter({ score: 10, cause: 'DEBT' }, ctx);
    scene.update(0.5, ctx);
    scene.onInput({ type: 'fireDown' });
    expect(transition).toHaveBeenCalledTimes(1);
    expect(transition).toHaveBeenCalledWith('Highscores', {});
  });

  it('ignores input until armed, then routes', () => {
    const { mgr, transition } = fakeManager();
    const scene = createGameOverScene({ sceneManager: mgr, repo: fakeRepo(true, 1), meta: fakeMeta(RUN) });
    scene.enter({ score: 9000, cause: 'X' }, ctx);
    scene.update(0.1, ctx); // still below the arm delay
    scene.onInput({ type: 'fireDown' });
    expect(transition).not.toHaveBeenCalled();
    scene.update(0.4, ctx); // now armed
    scene.onInput({ type: 'fireDown' });
    expect(transition).toHaveBeenCalledTimes(1);
  });
});
