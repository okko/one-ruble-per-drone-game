// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createUiShell, type UiShell } from '../shell/ui-shell';
import { createMainMenuScreen, type MainMenuVM } from './main-menu-screen';
import { createNameEntryScreen } from './name-entry-screen';
import { createGameOverScreen } from './game-over-screen';
import { el, icon, setText, setFlag } from './dom';
import { CREDITS } from '../../content/credits';
import { creditsLines } from '../credits-view';

let root: HTMLElement;
let shell: UiShell;

beforeEach(() => {
  root = document.createElement('div');
  root.id = 'ui';
  document.body.append(root);
  shell = createUiShell(root);
});

afterEach(() => {
  shell.dispose();
  root.remove();
});

function menuVM(over: Partial<MainMenuVM> = {}): MainMenuVM {
  return {
    title: 'ONE RUBLE PER DRONE',
    tagline: 'A ruble a drone',
    footer: 'FOOTER',
    items: [
      { id: 'start', label: 'START', enabled: true },
      { id: 'howto', label: 'HOW TO', enabled: true },
    ],
    selectedIndex: 0,
    panel: 'none',
    muted: false,
    howTo: ['Shoot the drones.', 'Do not die.'],
    creditsScrollY: 0,
    attract: { kind: 'teaser', lines: ['SOON', 'ISH'] },
    ...over,
  };
}

describe('dom helpers', () => {
  it('omits undefined and false attributes, and keeps true as a bare attribute', () => {
    const node = el('div', { 'data-a': undefined, 'data-b': false, 'data-c': true, 'data-d': 3 });
    expect(node.hasAttribute('data-a')).toBe(false);
    expect(node.hasAttribute('data-b')).toBe(false);
    expect(node.getAttribute('data-c')).toBe('');
    expect(node.getAttribute('data-d')).toBe('3');
  });

  it('never interprets a child string as markup', () => {
    const node = el('div', {}, '<script>x</script>');
    expect(node.querySelector('script')).toBeNull();
    expect(node.textContent).toBe('<script>x</script>');
  });

  it('gives every emoji icon an accessible label', () => {
    const node = icon('🔇', 'Muted');
    expect(node.className).toBe('icon');
    expect(node.getAttribute('aria-label')).toBe('Muted');
    expect(node.getAttribute('role')).toBe('img');
  });

  it('setText and setFlag only write on a real change', () => {
    const node = el('span', { text: 'a' });
    // Writing textContent replaces the child node, so node identity is the honest
    // witness to whether a write happened — and it survives without stubbing.
    const before = node.firstChild;
    setText(node, 'a');
    expect(node.firstChild).toBe(before);
    setText(node, 'b');
    expect(node.firstChild).not.toBe(before);
    expect(node.textContent).toBe('b');

    setFlag(node, 'hidden', false);
    expect(node.hasAttribute('hidden')).toBe(false);
    setFlag(node, 'hidden', true);
    expect(node.hasAttribute('hidden')).toBe(true);
    setFlag(node, 'hidden', true);
    expect(node.hasAttribute('hidden')).toBe(true);
  });
});

describe('main menu screen', () => {
  function mount(vm = menuVM()) {
    const onSelect = vi.fn();
    const onConfirm = vi.fn();
    const screen = createMainMenuScreen({ onSelect, onConfirm, roster: CREDITS });
    shell.show('menu', screen);
    screen.update(vm);
    return { screen, onSelect, onConfirm };
  }

  it('reports hover as selection and click as confirmation, separately', () => {
    const { onSelect, onConfirm } = mount();
    const second = root.querySelectorAll<HTMLButtonElement>('.ui-menu-item')[1];
    second?.dispatchEvent(new Event('pointerenter'));
    expect(onSelect).toHaveBeenCalledWith(1);
    expect(onConfirm).not.toHaveBeenCalled();
    second?.dispatchEvent(new Event('click'));
    expect(onConfirm).toHaveBeenCalledWith(1);
  });

  it('shows the credits roll and translates it by the scroll state', () => {
    const { screen } = mount();
    screen.update(menuVM({ panel: 'credits', creditsScrollY: 120 }));
    const lines = root.querySelectorAll('.credits-line');
    expect(lines).toHaveLength(creditsLines(CREDITS).length);
    expect(root.querySelector<HTMLElement>('.credits-roll')?.style.transform).toBe(
      'translateY(-120px)',
    );
  });

  it('shows the attract card as scores or teaser, whichever the scene asked for', () => {
    const { screen } = mount();
    screen.update(
      menuVM({
        panel: 'attract',
        attract: { kind: 'scores', heading: 'HEROES', rows: [{ name: 'IVA', score: '1 000' }] },
      }),
    );
    expect(root.textContent).toContain('HEROES');
    expect(root.textContent).toContain('1. IVA');
    expect(root.textContent).toContain('1 000');

    screen.update(menuVM({ panel: 'attract' }));
    expect(root.textContent).toContain('SOON');
  });

  it('hides the mute badge unless muted', () => {
    const { screen } = mount();
    expect(root.querySelector<HTMLElement>('.menu-mute')?.hidden).toBe(true);
    screen.update(menuVM({ muted: true }));
    expect(root.querySelector<HTMLElement>('.menu-mute')?.hidden).toBe(false);
  });

  it('points at the selection with aria-activedescendant instead of focusing an option', () => {
    const { screen } = mount();
    const menu = root.querySelector<HTMLElement>('.ui-menu');
    const items = root.querySelectorAll<HTMLButtonElement>('.ui-menu-item');
    expect(menu?.getAttribute('aria-activedescendant')).toBe(items[0]?.id);
    screen.update(menuVM({ selectedIndex: 1 }));
    expect(menu?.getAttribute('aria-activedescendant')).toBe(items[1]?.id);
    expect(document.activeElement).not.toBe(items[1]);
  });

  it('lets the scene own Enter, so a focused option cannot confirm a second time', () => {
    const { onConfirm } = mount();
    const first = root.querySelector<HTMLButtonElement>('.ui-menu-item');
    const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true });
    first?.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('name entry screen', () => {
  it('activates by index when a picker cell is clicked', () => {
    const onActivate = vi.fn();
    const screen = createNameEntryScreen({ onActivate });
    shell.show('entry', screen);
    screen.update({ headline: 'NEW BEST', rank: '#1', name: 'A', cells: ['A', 'B', 'END'], cursor: 0 });
    const cells = root.querySelectorAll<HTMLButtonElement>('.picker-cell');
    expect(cells).toHaveLength(3);
    cells[2]?.dispatchEvent(new Event('click'));
    expect(onActivate).toHaveBeenCalledWith(2);
  });

  it('marks the cursor cell and labels the invisible space glyph', () => {
    const screen = createNameEntryScreen({ onActivate: vi.fn() });
    shell.show('entry', screen);
    screen.update({ headline: '', rank: '', name: '', cells: ['A', ' '], cursor: 1 });
    const cells = root.querySelectorAll<HTMLButtonElement>('.picker-cell');
    expect(cells[0]?.getAttribute('aria-selected')).toBe('false');
    expect(cells[1]?.getAttribute('aria-selected')).toBe('true');
    expect(cells[1]?.textContent).toBe('SP');
    expect(cells[1]?.getAttribute('aria-label')).toBe('Space');
  });
});

describe('game over screen', () => {
  it('shows the summary and accents the score only on a qualifying run', () => {
    const screen = createGameOverScreen();
    shell.show('over', screen);
    screen.update({
      cause: 'EXHAUSTION',
      score: '12 345',
      drones: '87',
      shift: '4:20',
      prompt: 'nope',
      qualified: false,
    });
    expect(root.textContent).toContain('12 345');
    expect(root.textContent).toContain('EXHAUSTION');
    const score = root.querySelector('.stat-value');
    expect(score?.getAttribute('data-accent')).toBe('false');

    screen.update({
      cause: 'EXHAUSTION',
      score: '12 345',
      drones: '87',
      shift: '4:20',
      prompt: 'record!',
      qualified: true,
    });
    expect(score?.getAttribute('data-accent')).toBe('true');
    expect(root.textContent).toContain('record!');
  });
});

describe('the UI layer does not swallow aim input', () => {
  it('leaves the screen root click-through, and only opts controls back in', () => {
    // A full-bleed transparent container that eats pointerdown silently breaks
    // aiming. The shell root must stay click-through; only controls take pointers.
    const screen = createMainMenuScreen({ onSelect: vi.fn(), onConfirm: vi.fn(), roster: CREDITS });
    shell.show('menu', screen);
    screen.update(menuVM());

    // jsdom does not do layout, so assert the contract structurally: the root
    // carries no inline pointer capture, and every interactive control is a real
    // button that the stylesheet opts back in via `#ui button`.
    expect(root.style.pointerEvents).toBe('');
    const controls = root.querySelectorAll('.ui-menu-item');
    expect(controls.length).toBeGreaterThan(0);
    for (const c of controls) expect(c.tagName).toBe('BUTTON');
  });
});
