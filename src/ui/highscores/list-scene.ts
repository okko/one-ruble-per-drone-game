/**
 * Highscores list scene (docs/areas/08-highscores.md §3.7). Renders the sorted top-N table read from
 * the repo — rank, name, score (grouped), shift `m:ss`, date, and a notable stat — over the skyline.
 * The just-entered row (`highlightRank`) gets a highlight band. Back/Esc/confirm returns to the Main
 * Menu. No storage access here: the data comes from the injected `HighscoresRepo`.
 */
import type { Scene } from './../../state/scene';
import type { SceneManager } from './../../state/scene-manager';
import type { InputEvent } from '../../input/input';
import type { Renderer } from '../../render/renderer';
import type { HighscoresRepo } from '../../persistence/highscores-repo';
import type { HighscoreEntry } from '../../persistence/schemas';
import type { AudioEngineImpl } from '../../audio/engine';
import { drawSkyline } from '../../render/backdrop';
import { FLAVOR_LINES } from '../../content/highscores.flavor';
import { mmss, groupThousands, shortDate } from '../format';

export interface HighscoresListParams {
  highlightRank?: number;
}

export interface HighscoresListDeps {
  sceneManager: SceneManager;
  repo: HighscoresRepo;
  audio?: Pick<AudioEngineImpl, 'playSfx'>;
}

const ROW_Y0 = 46;
const ROW_H = 14;

export function createHighscoresListScene(deps: HighscoresListDeps): Scene<HighscoresListParams> {
  let entries: HighscoreEntry[] = [];
  let highlightRank: number | undefined;
  let flavor = '';

  return {
    enter(params: HighscoresListParams): void {
      entries = deps.repo.list();
      highlightRank = params.highlightRank;
      const idx = (highlightRank ?? entries.length) % FLAVOR_LINES.length;
      flavor = FLAVOR_LINES[idx] ?? '';
    },

    update(): void {},

    render(r: Renderer): void {
      drawSkyline(r, { dim: true });
      r.text('HIGHSCORES', r.width / 2, 18, { align: 'center', color: 'accentPink', font: 'font.display' });
      r.text(flavor, r.width / 2, 32, { align: 'center', color: 'cream' });

      entries.forEach((e, i) => {
        const y = ROW_Y0 + i * ROW_H;
        const isHi = highlightRank !== undefined && i + 1 === highlightRank;
        if (isHi) r.fillRect(2, y - 2, r.width - 4, ROW_H - 2, 'panelLite');
        const col = isHi ? 'flash' : 'cream';
        r.text(`${i + 1}`, 6, y, { color: col });
        r.text(e.name, 20, y, { color: col });
        r.text(groupThousands(e.score), 150, y, { align: 'right', color: 'rubleGold' });
        r.text(mmss(e.shiftSeconds), 158, y, { color: col });
        r.text(shortDate(e.dateISO), 198, y, { color: col });
        if (e.notable) r.text(e.notable, 252, y, { color: 'concrete' });
      });

      r.text('BACK', r.width / 2, 202, { align: 'center', color: 'cream' });
    },

    onInput(e: InputEvent): void {
      const back =
        e.type === 'fireDown' || (e.type === 'pointer' && e.down) || (e.type === 'key' && e.down);
      if (!back) return;
      deps.audio?.playSfx('uiSelect');
      deps.sceneManager.transition('MainMenu');
    },

    exit(): void {},
  };
}
