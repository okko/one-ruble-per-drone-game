// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createUiShell, type UiScreen, type UiShell } from './ui-shell';

/** A screen that records its lifecycle so the shell's contract can be asserted. */
function testScreen(label = 'Play'): UiScreen<string> & {
  readonly calls: string[];
  readonly host: HTMLElement | null;
} {
  const calls: string[] = [];
  let host: HTMLElement | null = null;
  return {
    calls,
    get host() {
      return host;
    },
    mount(root) {
      host = root;
      calls.push('mount');
      const button = document.createElement('button');
      button.textContent = label;
      root.appendChild(button);
    },
    update(vm) {
      calls.push(`update:${vm}`);
    },
    unmount() {
      calls.push('unmount');
      host?.replaceChildren();
    },
  };
}

describe('createUiShell', () => {
  let root: HTMLElement;
  let shell: UiShell;

  beforeEach(() => {
    vi.useFakeTimers();
    root = document.createElement('div');
    root.id = 'ui';
    document.body.appendChild(root);
    shell = createUiShell(root);
  });

  afterEach(() => {
    shell.dispose();
    root.remove();
    vi.useRealTimers();
  });

  it('mounts a screen into a host inside the root', () => {
    const screen = testScreen();
    shell.show('MainMenu', screen);

    const host = root.querySelector<HTMLElement>('[data-screen="MainMenu"]');
    expect(host).not.toBeNull();
    expect(screen.calls).toEqual(['mount']);
    expect(host?.textContent).toContain('Play');
    expect(shell.get('MainMenu')).toBe(screen);
  });

  it('focuses the first actionable element on mount', () => {
    shell.show('MainMenu', testScreen('Start New Shift'));

    expect(document.activeElement).toBeInstanceOf(HTMLButtonElement);
    expect(document.activeElement?.textContent).toBe('Start New Shift');
  });

  it('leaves the screen in the active state once mounted', () => {
    shell.show('MainMenu', testScreen());

    const host = root.querySelector<HTMLElement>('[data-screen="MainMenu"]');
    expect(host?.dataset['state']).toBe('active');
  });

  it('applies the scrim only when asked for', () => {
    shell.show('Plain', testScreen());
    shell.show('Scrimmed', testScreen(), { scrim: true });

    expect(root.querySelector<HTMLElement>('[data-screen="Plain"]')?.dataset['scrim']).toBeUndefined();
    expect(root.querySelector<HTMLElement>('[data-screen="Scrimmed"]')?.dataset['scrim']).toBe(
      'true',
    );
  });

  it('marks an overlay so it stacks above other screens', () => {
    shell.show('Paused', testScreen(), { overlay: true });

    const host = root.querySelector<HTMLElement>('[data-screen="Paused"]');
    expect(host?.classList.contains('ui-overlay')).toBe(true);
  });

  it('unmounts the screen and removes its DOM on hide', () => {
    const screen = testScreen();
    shell.show('MainMenu', screen);

    shell.hide('MainMenu');
    vi.runAllTimers();

    expect(screen.calls).toEqual(['mount', 'unmount']);
    expect(root.querySelector('[data-screen="MainMenu"]')).toBeNull();
    expect(shell.get('MainMenu')).toBeUndefined();
  });

  it('replaces an existing screen mounted under the same id', () => {
    const first = testScreen('First');
    const second = testScreen('Second');

    shell.show('MainMenu', first);
    shell.show('MainMenu', second);
    vi.runAllTimers();

    expect(first.calls).toContain('unmount');
    expect(shell.get('MainMenu')).toBe(second);
    expect(root.querySelectorAll('[data-screen="MainMenu"]')).toHaveLength(1);
    expect(root.textContent).toContain('Second');
    expect(root.textContent).not.toContain('First');
  });

  it('restores focus to the underlying screen when an overlay closes', () => {
    shell.show('MainMenu', testScreen('Resume'));
    const menuButton = document.activeElement;

    shell.show('Paused', testScreen('Quit'), { overlay: true });
    expect(document.activeElement?.textContent).toBe('Quit');

    shell.hide('Paused');
    expect(document.activeElement).toBe(menuButton);
  });

  it('does not restore focus when a non-overlay screen closes', () => {
    shell.show('MainMenu', testScreen('Resume'));
    const menuButton = document.activeElement;

    shell.show('Settings', testScreen('Back'));
    shell.hide('Settings');

    expect(document.activeElement).not.toBe(menuButton);
  });

  it('ignores hiding a screen that was never shown', () => {
    expect(() => shell.hide('Nope')).not.toThrow();
  });

  it('unmounts everything and empties the root on dispose', () => {
    const menu = testScreen();
    const pause = testScreen();
    shell.show('MainMenu', menu);
    shell.show('Paused', pause, { overlay: true });

    shell.dispose();

    expect(menu.calls).toContain('unmount');
    expect(pause.calls).toContain('unmount');
    expect(root.children).toHaveLength(0);
    expect(shell.get('MainMenu')).toBeUndefined();
  });

  it('does not leave a dangling removal timer after dispose', () => {
    shell.show('MainMenu', testScreen());
    shell.dispose();

    // A timer that fired after dispose would try to remove an already-detached
    // host; running the clock must be inert.
    expect(() => {
      vi.runAllTimers();
    }).not.toThrow();
    expect(root.children).toHaveLength(0);
  });
});
