/**
 * Highscore name-entry scene (docs/areas/08-highscores.md §3.6). Two coexisting input methods:
 *  - keyboard: letter/digit/space keys append, Backspace deletes, Enter confirms;
 *  - on-screen character picker (the TOUCH method, no hardware keyboard on mobile): Arrow keys move
 *    a cursor over the glyph grid and the primary action (fireDown) activates the highlighted cell,
 *    while a tap activates a cell directly — the picker is real DOM buttons, so hit-testing is the
 *    browser's job. The `DEL` / `END` cells delete / confirm.
 * On confirm the name is validated (`validateName`), saved via the injected `HighscoresRepo.add`
 * (the only persistence path), and the scene routes to the Highscores list with the new row's rank.
 * `dateISO` comes from the injected `now()` (clock-free logic; the host passes the real clock).
 */
import type { Scene } from './../../state/scene';
import type { SceneManager } from './../../state/scene-manager';
import type { InputEvent } from '../../input/input';
import type { HighscoresRepo } from '../../persistence/highscores-repo';
import type { HighscoreEntry, RunSummary } from '../../persistence/schemas';
import type { AudioEngineImpl } from '../../audio/engine';
import type { UiShell } from '../shell/ui-shell';
import { createNameEntryScreen, type NameEntryVM } from '../screens/name-entry-screen';
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
  /** Absent in node tests, where name assembly and persistence are what is under test. */
  shell?: UiShell | undefined;
}

export interface HighscoreEntryScene extends Scene<HighscoreEntryParams> {
  readonly name: string;
  readonly cursor: number;
}

/** Glyph grid + the two command cells, in cursor order. */
export const PICKER_CELLS: readonly string[] = [...NAME_GLYPHS, 'DEL', 'END'];
/**
 * Columns the arrow-key cursor wraps at. The DOM grid reflows to fit the viewport, so this is now
 * purely the keyboard's model of the grid rather than a layout constant — arrow navigation stays
 * predictable at any width.
 */
export const PICKER_COLS = 14;

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

  const rows = Math.ceil(PICKER_CELLS.length / PICKER_COLS);

  function moveCursor(dx: number, dy: number): void {
    const cols = PICKER_COLS;
    let col = cursor % cols;
    let row = Math.floor(cursor / cols);
    col = (col + dx + cols) % cols;
    row = (row + dy + rows) % rows;
    cursor = Math.min(row * cols + col, PICKER_CELLS.length - 1);
    deps.audio?.playSfx('uiSelect');
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
    cursor = index;
    if (cell === 'DEL') backspace();
    else if (cell === 'END') commit();
    else append(cell);
  }

  const screen = deps.shell ? createNameEntryScreen({ onActivate: activate }) : undefined;

  function vm(): NameEntryVM {
    return {
      headline: NEW_BEST_LINE,
      rank: `RANK #${params.rank}`,
      name,
      cells: PICKER_CELLS,
      cursor,
    };
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
      if (deps.shell && screen) {
        deps.shell.show('name-entry', screen, { scrim: true });
        screen.update(vm());
      }
    },

    update(): void {},

    render(): void {
      screen?.update(vm());
    },

    onInput(e: InputEvent): void {
      switch (e.type) {
        case 'fireDown':
          activate(cursor);
          break;
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
        // Taps on the picker arrive as DOM clicks on the cell itself, so raw pointer
        // events here would double-activate.
        case 'pointer':
        case 'aim':
        case 'fireUp':
          break;
      }
    },

    exit(): void {
      deps.shell?.hide('name-entry');
    },
  };
}
