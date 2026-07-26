/**
 * Main Menu screen (docs/areas/07-main-menu.md, docs/areas/10-hud-ui.md §3.2).
 *
 * DOM only. Every decision — which item is selected, which panel is open,
 * whether attract mode has engaged — belongs to `main-menu-scene.ts`; this
 * renders that decision and reports pointer intent back through callbacks.
 *
 * The option list is real `<button>` elements inside a `role="menu"`, so pointer
 * hit-testing is the browser's job rather than arithmetic against arena
 * coordinates, and the menu is keyboard- and screen-reader-navigable for free.
 */
import '../styles/screens.css';
import type { UiScreen } from '../shell/ui-shell';
import { el, icon, setText } from './dom';
import { creditsLines, type CreditsLine } from '../credits-view';
import type { CreditsRoster } from '../../content/credits';

export type MenuPanel = 'none' | 'howto' | 'credits' | 'attract';

export interface MainMenuVM {
  title: string;
  tagline: string;
  footer: string;
  items: ReadonlyArray<{ id: string; label: string; enabled: boolean }>;
  selectedIndex: number;
  panel: MenuPanel;
  muted: boolean;
  howTo: readonly string[];
  /** Pixels the credits roll has scrolled up from the bottom edge. */
  creditsScrollY: number;
  attract: AttractVM;
}

export type AttractVM =
  | { kind: 'scores'; heading: string; rows: ReadonlyArray<{ name: string; score: string }> }
  | { kind: 'teaser'; lines: readonly string[] };

export interface MainMenuScreenDeps {
  /** Pointer moved onto option `i` (hover/drag): selection only, never activation. */
  onSelect(index: number): void;
  /** Option `i` was activated (click, Enter, or Space on the button). */
  onConfirm(index: number): void;
  roster: CreditsRoster;
}

export function createMainMenuScreen(deps: MainMenuScreenDeps): UiScreen<MainMenuVM> {
  const title = el('h1', { class: 'ui-title' });
  const tagline = el('p', { class: 'ui-tagline' });
  const list = el('div', { class: 'ui-menu', role: 'menu' });
  const footer = el('div', { class: 'screen-footer' });
  const muteBadge = el(
    'div',
    { class: 'menu-mute', hidden: true },
    icon('🔇', 'Muted'),
    el('span', { text: 'MUTE' }),
  );

  const menuView = el(
    'div',
    { class: 'screen-body' },
    el('div', { class: 'menu-masthead' }, title, tagline),
    list,
  );

  // --- Panels -------------------------------------------------------------
  const howToList = el('ul', { class: 'panel-lines' });
  const howToView = panelView('HOW TO PLAY', howToList);

  const creditsRoll = el('div', { class: 'credits-roll' });
  const creditsView = panelView('CREDITS', el('div', { class: 'credits-viewport' }, creditsRoll));

  const attractHeading = el('h2', { class: 'ui-title' });
  const attractBody = el('div', { class: 'screen-body' });
  const attractView = el('div', { class: 'screen-body' }, attractHeading, attractBody);

  const root = el('div', { class: 'screen-body' });
  const views: Record<MenuPanel, HTMLElement> = {
    none: menuView,
    howto: howToView,
    credits: creditsView,
    attract: attractView,
  };

  let buttons: HTMLButtonElement[] = [];
  let shownPanel: MenuPanel | null = null;
  let creditsBuilt = false;
  let lastScrollY = Number.NaN;

  function panelView(heading: string, body: HTMLElement): HTMLElement {
    return el(
      'div',
      { class: 'screen-body' },
      el('h2', { class: 'ui-title', text: heading }),
      body,
      el('div', { class: 'screen-footer', text: 'ESC to go back' }),
    );
  }

  function buildItems(vm: MainMenuVM): void {
    buttons = vm.items.map(
      (item) =>
        el('button', {
          class: 'ui-menu-item',
          type: 'button',
          role: 'menuitem',
          'data-item': item.id,
          text: item.label,
        }) as HTMLButtonElement,
    );
    buttons.forEach((b, i) => {
      b.addEventListener('click', () => deps.onConfirm(i));
      // Hover selects but never activates: a pointer sliding across the list must
      // not fire an option the player only passed over.
      b.addEventListener('pointerenter', () => deps.onSelect(i));
    });
    list.replaceChildren(...buttons);
  }

  function buildCredits(): void {
    creditsRoll.replaceChildren(
      ...creditsLines(deps.roster).map((line: CreditsLine) =>
        el('div', { class: 'credits-line', 'data-kind': line.kind, text: line.text }),
      ),
    );
    creditsBuilt = true;
  }

  function renderAttract(a: AttractVM): void {
    if (a.kind === 'scores') {
      setText(attractHeading, a.heading);
      attractBody.replaceChildren(
        ...a.rows.map((row, i) =>
          el(
            'div',
            { class: 'stat' },
            el('span', { class: 'stat-label', text: `${i + 1}. ${row.name}` }),
            el('span', { class: 'stat-value', 'data-accent': 'true', text: row.score }),
          ),
        ),
      );
    } else {
      setText(attractHeading, a.lines[0] ?? '');
      attractBody.replaceChildren(
        ...a.lines.slice(1).map((line) => el('p', { class: 'ui-tagline', text: line })),
      );
    }
  }

  return {
    mount(host) {
      host.append(muteBadge, root);
    },

    update(vm) {
      setText(title, vm.title);
      setText(tagline, vm.tagline);
      setText(footer, vm.footer);
      muteBadge.hidden = !vm.muted;

      if (buttons.length !== vm.items.length) buildItems(vm);
      vm.items.forEach((item, i) => {
        const b = buttons[i];
        if (!b) return;
        setText(b, item.label);
        b.setAttribute('aria-selected', String(i === vm.selectedIndex));
        b.setAttribute('aria-disabled', String(!item.enabled));
        b.disabled = !item.enabled;
      });

      if (howToList.childElementCount !== vm.howTo.length) {
        howToList.replaceChildren(...vm.howTo.map((line) => el('li', { text: line })));
      }

      if (vm.panel === 'credits') {
        if (!creditsBuilt) buildCredits();
        if (vm.creditsScrollY !== lastScrollY) {
          lastScrollY = vm.creditsScrollY;
          creditsRoll.style.transform = `translateY(${-vm.creditsScrollY}px)`;
        }
      }

      if (vm.panel === 'attract') renderAttract(vm.attract);

      if (vm.panel !== shownPanel) {
        shownPanel = vm.panel;
        root.replaceChildren(views[vm.panel], footer);
        // Returning to the root menu re-focuses the selected option, so a player
        // who closed a panel with the keyboard is not stranded on <body>.
        if (vm.panel === 'none') buttons[vm.selectedIndex]?.focus();
      }
    },

    unmount() {
      root.remove();
      muteBadge.remove();
    },
  };
}
