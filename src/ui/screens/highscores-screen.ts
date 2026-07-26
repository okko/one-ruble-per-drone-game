/**
 * Highscores list screen (docs/areas/08-highscores.md §3.7, docs/areas/10-hud-ui.md §3.5).
 *
 * A real `<table>`: the data is tabular, so the semantics are free and the row
 * highlight can be `aria-current` rather than a colour a screen reader cannot
 * see. Names come from player input and are written with `textContent` only.
 */
import '../styles/screens.css';
import type { UiScreen } from '../shell/ui-shell';
import { el, setText } from './dom';

export interface ScoreRowVM {
  rank: number;
  name: string;
  score: string;
  shift: string;
  date: string;
  notable: string;
}

export interface HighscoresVM {
  flavor: string;
  rows: readonly ScoreRowVM[];
  /** 1-based rank of the row just entered, if any. */
  highlightRank: number | undefined;
}

const COLUMNS = ['#', 'Name', 'Score', 'Shift', 'Date', 'Notable'] as const;

export function createHighscoresScreen(): UiScreen<HighscoresVM> {
  const flavor = el('p', { class: 'ui-tagline' });
  const body = el('tbody');
  const table = el(
    'table',
    { class: 'scores' },
    el('thead', {}, el('tr', {}, ...COLUMNS.map((c) => el('th', { scope: 'col', text: c })))),
    body,
  );

  const root = el(
    'div',
    { class: 'screen-body' },
    el('h1', { class: 'ui-title', text: 'HIGHSCORES' }),
    flavor,
    table,
    el('div', { class: 'screen-footer', text: 'Any key to go back' }),
  );

  let rendered: readonly ScoreRowVM[] = [];

  return {
    mount(host) {
      host.append(root);
    },

    update(vm) {
      setText(flavor, vm.flavor);
      // The table is static for the life of the screen; rebuilding it every frame
      // would churn DOM for nothing.
      if (vm.rows !== rendered) {
        rendered = vm.rows;
        body.replaceChildren(
          ...vm.rows.map((row) =>
            el(
              'tr',
              { 'aria-current': row.rank === vm.highlightRank ? 'true' : undefined },
              el('td', { class: 'col-rank', text: String(row.rank) }),
              el('td', { text: row.name }),
              el('td', { class: 'col-score', text: row.score }),
              el('td', { text: row.shift }),
              el('td', { text: row.date }),
              el('td', { text: row.notable }),
            ),
          ),
        );
      }
    },

    unmount() {
      root.remove();
    },
  };
}
