/**
 * Highscores list scene (docs/areas/08-highscores.md §3.7). Reads the sorted top-N table from the
 * repo and hands it to the DOM table screen — rank, name, score (grouped), shift `m:ss`, date, and
 * a notable stat. The just-entered row (`highlightRank`) is marked so the screen can call it out.
 * Back/Esc/confirm returns to the Main Menu. No storage access here: the data comes from the
 * injected `HighscoresRepo`.
 */
import type { Scene } from './../../state/scene';
import type { SceneManager } from './../../state/scene-manager';
import type { InputEvent } from '../../input/input';
import type { HighscoresRepo } from '../../persistence/highscores-repo';
import type { AudioEngineImpl } from '../../audio/engine';
import type { UiShell } from '../shell/ui-shell';
import { createHighscoresScreen, type HighscoresVM } from '../screens/highscores-screen';
import { FLAVOR_LINES } from '../../content/highscores.flavor';
import { mmss, groupThousands, shortDate } from '../format';

export interface HighscoresListParams {
  highlightRank?: number;
}

export interface HighscoresListDeps {
  sceneManager: SceneManager;
  repo: HighscoresRepo;
  audio?: Pick<AudioEngineImpl, 'playSfx'>;
  /** Absent in node tests, where routing is what is under test. */
  shell?: UiShell | undefined;
}

export function createHighscoresListScene(deps: HighscoresListDeps): Scene<HighscoresListParams> {
  // Built on first show, never without a shell: a scene under node test has no document.
  let screen: ReturnType<typeof createHighscoresScreen> | undefined;
  // Built once on enter, not per frame: the table cannot change while it is shown.
  let vm: HighscoresVM = { flavor: '', rows: [], highlightRank: undefined };

  return {
    enter(params: HighscoresListParams): void {
      const entries = deps.repo.list();
      const idx = (params.highlightRank ?? entries.length) % FLAVOR_LINES.length;
      vm = {
        flavor: FLAVOR_LINES[idx] ?? '',
        highlightRank: params.highlightRank,
        rows: entries.map((e, i) => ({
          rank: i + 1,
          name: e.name,
          score: groupThousands(e.score),
          shift: mmss(e.shiftSeconds),
          date: shortDate(e.dateISO),
          notable: e.notable ?? '',
        })),
      };
      if (deps.shell) {
        screen ??= createHighscoresScreen();
        deps.shell.show('highscores', screen, { scrim: true });
        screen.update(vm);
      }
    },

    update(): void {},

    render(): void {
      screen?.update(vm);
    },
    onInput(e: InputEvent): void {
      const back =
        e.type === 'fireDown' || (e.type === 'pointer' && e.down) || (e.type === 'key' && e.down);
      if (!back) return;
      deps.audio?.playSfx('uiSelect');
      deps.sceneManager.transition('MainMenu');
    },

    exit(): void {
      deps.shell?.hide('highscores');
    },
  };
}
