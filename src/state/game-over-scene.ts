/**
 * Game Over scene (docs/areas/08-highscores.md §3.4, docs/areas/09-state-and-persistence.md §3.3).
 * `wireGameOver` records the run into MetaStats and transitions here with `{score, cause}`; this
 * scene recovers the full run summary from `meta.lastRun` (no new transition params needed — see the
 * Phase-5 plan), shows a brief cheerful-but-grim shift summary, and on the next input routes by
 * qualification: a qualifying score → `HighscoreEntry` (carrying score+rank+runSummary), otherwise
 * straight to the `Highscores` list. Input is "armed" after a short delay so a key still held from
 * gameplay can't instantly skip the summary.
 */
import type { Scene } from './scene';
import type { SceneManager } from './scene-manager';
import type { InputEvent } from '../input/input';
import type { Renderer } from '../render/renderer';
import type { HighscoresRepo } from '../persistence/highscores-repo';
import type { MetaStatsRepo } from '../persistence/meta-stats-repo';
import type { RunSummary } from '../persistence/schemas';
import type { AudioEngineImpl } from '../audio/engine';
import { drawSkyline } from '../render/backdrop';
import { NO_CUT_LINE } from '../content/highscores.flavor';
import { mmss, groupThousands } from '../ui/format';

const ARM_S = 0.4;

export interface GameOverParams {
  score: number;
  cause: string;
}

export interface GameOverDeps {
  sceneManager: SceneManager;
  repo: HighscoresRepo;
  meta: MetaStatsRepo;
  audio?: Pick<AudioEngineImpl, 'playSfx'>;
}

export function createGameOverScene(deps: GameOverDeps): Scene<GameOverParams> {
  let score = 0;
  let cause = '';
  let summary: RunSummary = { score: 0, shiftSeconds: 0, dronesDowned: 0, cause: '' };
  let willQualify = false;
  let rank = 0;
  let elapsed = 0;

  return {
    enter(params: GameOverParams): void {
      score = params.score;
      cause = params.cause;
      const last = deps.meta.get().lastRun;
      summary = {
        score,
        cause,
        shiftSeconds: last?.shiftSeconds ?? 0,
        dronesDowned: last?.dronesDowned ?? 0,
      };
      willQualify = deps.repo.qualifies(score);
      rank = deps.repo.rankFor(score);
      elapsed = 0;
    },

    update(dt: number): void {
      elapsed += dt;
    },

    render(r: Renderer): void {
      drawSkyline(r, { phase: 'night', dim: true });
      r.text('SHIFT OVER', r.width / 2, 34, { align: 'center', color: 'accentPink', font: 'font.display' });
      if (cause) r.text(cause.toUpperCase(), r.width / 2, 54, { align: 'center', color: 'cream' });
      r.text(`SCORE ${groupThousands(score)}`, r.width / 2, 82, { align: 'center', color: 'rubleGold' });
      r.text(`DRONES ${summary.dronesDowned}`, r.width / 2, 96, { align: 'center', color: 'cream' });
      r.text(`SHIFT ${mmss(summary.shiftSeconds)}`, r.width / 2, 110, { align: 'center', color: 'cream' });
      const prompt = willQualify ? 'A NEW RECORD — PRESS TO SIGN IN' : NO_CUT_LINE;
      r.text(prompt, r.width / 2, 150, { align: 'center', color: 'cream' });
    },

    onInput(e: InputEvent): void {
      if (elapsed < ARM_S) return;
      const confirm =
        e.type === 'fireDown' || (e.type === 'pointer' && e.down) || (e.type === 'key' && e.down);
      if (!confirm) return;
      deps.audio?.playSfx('uiConfirm');
      if (willQualify) {
        deps.sceneManager.transition('HighscoreEntry', { score, rank, runSummary: summary });
      } else {
        deps.sceneManager.transition('Highscores', {});
      }
    },

    exit(): void {},
  };
}
