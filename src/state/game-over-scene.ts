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
import type { HighscoresRepo } from '../persistence/highscores-repo';
import type { MetaStatsRepo } from '../persistence/meta-stats-repo';
import type { RunSummary } from '../persistence/schemas';
import type { AudioEngineImpl } from '../audio/engine';
import type { UiShell } from '../ui/shell/ui-shell';
import { createGameOverScreen, type GameOverVM } from '../ui/screens/game-over-screen';
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
  /** Absent in node tests, where qualification and routing are what is under test. */
  shell?: UiShell | undefined;
}

export function createGameOverScene(deps: GameOverDeps): Scene<GameOverParams> {
  let score = 0;
  let cause = '';
  let summary: RunSummary = { score: 0, shiftSeconds: 0, dronesDowned: 0, cause: '' };
  let willQualify = false;
  let rank = 0;
  let elapsed = 0;
  // Built on first show, never without a shell: a scene under node test has no document.
  let screen: ReturnType<typeof createGameOverScreen> | undefined;

  function vm(): GameOverVM {
    return {
      cause: cause.toUpperCase(),
      score: groupThousands(score),
      drones: String(summary.dronesDowned),
      shift: mmss(summary.shiftSeconds),
      prompt: willQualify ? 'A new record \u2014 press to sign in' : NO_CUT_LINE,
      qualified: willQualify,
    };
  }

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
      if (deps.shell) {
        screen ??= createGameOverScreen();
        deps.shell.show('gameover', screen, { scrim: true });
        screen.update(vm());
      }
    },

    update(dt: number): void {
      elapsed += dt;
    },

    render(): void {
      screen?.update(vm());
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

    exit(): void {
      deps.shell?.hide('gameover');
    },
  };
}
