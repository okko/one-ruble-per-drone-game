/**
 * Highscore name-entry scene (docs/areas/08-highscores.md §3.6). Two coexisting input methods:
 *  - keyboard: letter/digit/space keys append, Backspace deletes, Enter confirms;
 *  - on-screen character picker (the TOUCH method, no hardware keyboard on mobile): Arrow keys / a
 *    pointer tap move a cursor over a retro glyph grid, the primary action (fireDown / tap) activates
 *    the highlighted cell, and the `DEL` / `END` cells delete / confirm — fully playable by touch.
 * On confirm the name is validated (`validateName`), saved via the injected `HighscoresRepo.add`
 * (the only persistence path), and the scene routes to the Highscores list with the new row's rank.
 * `dateISO` comes from the injected `now()` (clock-free logic; the host passes the real clock).
 */
import type { Scene } from './../../state/scene';
import type { SceneManager } from './../../state/scene-manager';
import type { InputEvent } from '../../input/input';
import type { Renderer } from '../../render/renderer';
import type { HighscoresRepo } from '../../persistence/highscores-repo';
import type { HighscoreEntry, RunSummary } from '../../persistence/schemas';
import type { AudioEngineImpl } from '../../audio/engine';
import { drawSkyline } from '../../render/backdrop';
import { NAME_GLYPHS } from '../../content/highscores.glyphs';
import { NEW_BEST_LINE } from '../../content/highscores.flavor';
import { validateName, MAX_NAME_LEN } from './table';

export interface HighscoreEntryParams {
  score: number;
  rank: number;
  runSummary: RunSummary;
}

export interface HighscoreEntryDeps {
  sceneManager: SceneManager;
  repo: HighscoresRepo;
  now: () => string; // ISO timestamp provider (clock injected by the host)
  audio?: Pick<AudioEngineImpl, 'playSfx'>;
}

export interface HighscoreEntryScene extends Scene<HighscoreEntryParams> {
  readonly name: string;
  readonly cursor: number;
}

/** Glyph grid + the two command cells, in cursor order. */
export const PICKER_CELLS: readonly string[] = [...NAME_GLYPHS, 'DEL', 'END'];
export const PICKER = { cols: 14, cellW: 26, cellH: 16, originX: 10, originY: 128 } as const;

const ARROWS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

function codeToGlyph(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (code === 'Space') return ' ';
  if (code === 'Minus') return '-';
  if (code === 'Period') return '.';
  return null;
}

export function createHighscoreEntryScene(deps: HighscoreEntryDeps): HighscoreEntryScene {
  let name = '';
  let cursor = 0;
  let params: HighscoreEntryParams = {
    score: 0,
    rank: 0,
    runSummary: { score: 0, shiftSeconds: 0, dronesDowned: 0, cause: '' },
  };

  const rows = Math.ceil(PICKER_CELLS.length / PICKER.cols);

  function moveCursor(dx: number, dy: number): void {
    const cols = PICKER.cols;
    let col = cursor % cols;
    let row = Math.floor(cursor / cols);
    col = (col + dx + cols) % cols;
    row = (row + dy + rows) % rows;
    cursor = Math.min(row * cols + col, PICKER_CELLS.length - 1);
    deps.audio?.playSfx('uiSelect');
  }

  function cellAt(x: number, y: number): number | null {
    const col = Math.floor((x - PICKER.originX) / PICKER.cellW);
    const row = Math.floor((y - PICKER.originY) / PICKER.cellH);
    if (col < 0 || col >= PICKER.cols || row < 0 || row >= rows) return null;
    const idx = row * PICKER.cols + col;
    return idx < PICKER_CELLS.length ? idx : null;
  }

  function append(glyph: string): void {
    if (name.length < MAX_NAME_LEN) {
      name += glyph;
      deps.audio?.playSfx('uiSelect');
    }
  }

  function backspace(): void {
    if (name.length > 0) {
      name = name.slice(0, -1);
      deps.audio?.playSfx('uiSelect');
    }
  }

  function commit(): void {
    const finalName = validateName(name);
    const { runSummary } = params;
    const entry: HighscoreEntry = {
      name: finalName,
      score: runSummary.score,
      shiftSeconds: runSummary.shiftSeconds,
      dronesDowned: runSummary.dronesDowned,
      dateISO: deps.now(),
      ...(runSummary.cause ? { notable: runSummary.cause } : {}),
    };
    const { rank } = deps.repo.add(entry);
    deps.audio?.playSfx('uiConfirm');
    deps.sceneManager.transition('Highscores', { highlightRank: rank });
  }

  function activate(index: number): void {
    const cell = PICKER_CELLS[index];
    if (cell === undefined) return;
    if (cell === 'DEL') backspace();
    else if (cell === 'END') commit();
    else append(cell);
  }

  return {
    get name(): string {
      return name;
    },
    get cursor(): number {
      return cursor;
    },

    enter(p: HighscoreEntryParams): void {
      params = p;
      name = '';
      cursor = 0;
    },

    update(): void {},

    render(r: Renderer): void {
      drawSkyline(r, { dim: true });
      r.text(NEW_BEST_LINE, r.width / 2, 14, { align: 'center', color: 'accentPink' });
      r.text(`RANK #${params.rank}`, r.width / 2, 28, { align: 'center', color: 'rubleGold' });
      r.text(`${name}_`, r.width / 2, 52, { align: 'center', color: 'cream', font: 'font.display' });

      PICKER_CELLS.forEach((cell, i) => {
        const col = i % PICKER.cols;
        const row = Math.floor(i / PICKER.cols);
        const x = PICKER.originX + col * PICKER.cellW;
        const y = PICKER.originY + row * PICKER.cellH;
        if (i === cursor) r.fillRect(x, y - 2, PICKER.cellW - 2, PICKER.cellH - 2, 'panelLite');
        const label = cell === ' ' ? 'SP' : cell;
        r.text(label, x + PICKER.cellW / 2, y, { align: 'center', color: i === cursor ? 'flash' : 'cream' });
      });

      r.text('ARROWS + FIRE / TAP · END TO CONFIRM', r.width / 2, 200, { align: 'center', color: 'cream' });
    },

    onInput(e: InputEvent): void {
      switch (e.type) {
        case 'fireDown':
          activate(cursor);
          break;
        case 'pointer': {
          if (!e.down) break;
          const idx = cellAt(e.world.x, e.world.y);
          if (idx !== null) {
            cursor = idx;
            activate(idx);
          }
          break;
        }
        case 'key': {
          if (!e.down) break;
          if (ARROWS.has(e.code)) {
            if (e.code === 'ArrowLeft') moveCursor(-1, 0);
            else if (e.code === 'ArrowRight') moveCursor(1, 0);
            else if (e.code === 'ArrowUp') moveCursor(0, -1);
            else moveCursor(0, 1);
          } else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
            commit();
          } else if (e.code === 'Backspace') {
            backspace();
          } else {
            const g = codeToGlyph(e.code);
            if (g) append(g);
          }
          break;
        }
        case 'aim':
        case 'fireUp':
          break;
      }
    },

    exit(): void {},
  };
}
