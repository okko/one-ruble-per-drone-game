/**
 * Highscore name-entry screen (docs/areas/08-highscores.md §3.6, docs/areas/10-hud-ui.md §3.6).
 *
 * The glyph picker is the touch input method, so every cell is a real `<button>`
 * that clears the 44px tap minimum. The hardware keyboard path is unchanged and
 * still handled by the scene; both drive the same cursor, which this reflects.
 */
import '../styles/screens.css';
import type { UiScreen } from '../shell/ui-shell';
import { el, setText } from './dom';

export interface NameEntryVM {
  headline: string;
  rank: string;
  name: string;
  cells: readonly string[];
  cursor: number;
}

export interface NameEntryScreenDeps {
  /** A picker cell was activated by pointer or click. */
  onActivate(index: number): void;
}

/** Cells that issue a command rather than contributing a character. */
const COMMANDS = new Set(['DEL', 'END']);

export function createNameEntryScreen(deps: NameEntryScreenDeps): UiScreen<NameEntryVM> {
  const headline = el('p', { class: 'ui-eyebrow' });
  const rank = el('p', { class: 'ui-tagline' });
  const caret = el('span', { class: 'name-caret', text: '_' });
  const nameText = el('span');
  // The name updates on every keystroke and is the thing the player is watching,
  // so it is a live region.
  const nameBox = el(
    'div',
    { class: 'name-display', role: 'status', 'aria-live': 'polite' },
    nameText,
    caret,
  );
  const picker = el('div', { class: 'picker', role: 'group', 'aria-label': 'Character picker' });

  const root = el(
    'div',
    { class: 'screen-body' },
    headline,
    rank,
    nameBox,
    picker,
    el('div', { class: 'screen-footer', text: 'Arrows + Fire · END to confirm' }),
  );

  let buttons: HTMLButtonElement[] = [];

  function build(cells: readonly string[]): void {
    buttons = cells.map((cell) => {
      const isCommand = COMMANDS.has(cell);
      const b = el('button', {
        class: 'picker-cell',
        type: 'button',
        // A space is a legal name character but an invisible label, so it gets a
        // printable caption and an accessible name of its own.
        text: cell === ' ' ? 'SP' : cell,
        'aria-label': cell === ' ' ? 'Space' : cell,
        'data-command': isCommand,
      }) as HTMLButtonElement;
      return b;
    });
    buttons.forEach((b, i) => b.addEventListener('click', () => deps.onActivate(i)));
    picker.replaceChildren(...buttons);
  }

  return {
    mount(host) {
      host.append(root);
    },

    update(vm) {
      setText(headline, vm.headline);
      setText(rank, vm.rank);
      setText(nameText, vm.name);
      if (buttons.length !== vm.cells.length) build(vm.cells);
      buttons.forEach((b, i) => b.setAttribute('aria-selected', String(i === vm.cursor)));
    },

    unmount() {
      root.remove();
    },
  };
}
