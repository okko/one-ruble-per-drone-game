import '../styles/tokens.css';
import '../styles/shell.css';

/**
 * The UI shell: owner of the `#ui` root, of which screens are mounted, of the
 * transitions between them, and of focus (docs/areas/10-hud-ui.md §3.1c/§4).
 *
 * Screens own DOM and no game logic. The shell owns lifecycle and no game logic
 * either — the `SceneManager` decides what is shown; this just shows it well.
 */

/** One mounted piece of UI. */
export interface UiScreen<VM = unknown> {
  mount(root: HTMLElement): void;
  update(vm: VM): void;
  unmount(): void;
}

export interface UiShell {
  /** Mounts `screen` under `id`, replacing any screen already mounted there. */
  show(id: string, screen: UiScreen, opts?: ShowOptions): void;
  /** Unmounts the screen registered under `id`. A no-op if nothing is mounted. */
  hide(id: string): void;
  /** The screen mounted under `id`, or undefined. */
  get(id: string): UiScreen | undefined;
  dispose(): void;
}

export interface ShowOptions {
  /** Dim the live 3D scene behind the screen so type stays legible. */
  scrim?: boolean;
  /** Stack above other screens (pause, dialogs). */
  overlay?: boolean;
}

interface Mounted {
  screen: UiScreen;
  host: HTMLElement;
  /** Focus to restore when this screen goes away — set for overlays. */
  restoreFocus: Element | null;
}

/**
 * How long a screen's exit transition is given before its DOM is removed. Must
 * stay in step with `--dur-med` in tokens.css; the shell reads the computed
 * value at runtime so `reducedMotion` (which zeroes the token) removes the wait
 * entirely rather than leaving a dead pause.
 */
function exitDurationMs(root: HTMLElement): number {
  const raw = getComputedStyle(root).getPropertyValue('--dur-med').trim();
  if (raw.endsWith('ms')) return Number.parseFloat(raw) || 0;
  if (raw.endsWith('s')) return (Number.parseFloat(raw) || 0) * 1000;
  return 0;
}

export function createUiShell(root: HTMLElement): UiShell {
  const mounted = new Map<string, Mounted>();
  const pendingRemovals = new Set<ReturnType<typeof setTimeout>>();

  function removeHost(host: HTMLElement, delayMs: number): void {
    if (delayMs <= 0) {
      host.remove();
      return;
    }
    const timer = setTimeout(() => {
      pendingRemovals.delete(timer);
      host.remove();
    }, delayMs);
    pendingRemovals.add(timer);
  }

  function unmount(id: string): void {
    const entry = mounted.get(id);
    if (!entry) return;
    mounted.delete(id);

    entry.screen.unmount();
    entry.host.dataset['state'] = 'exiting';
    removeHost(entry.host, exitDurationMs(root));

    // Overlays borrow focus; give it back so the player does not lose their
    // place in the menu underneath.
    if (entry.restoreFocus instanceof HTMLElement && entry.restoreFocus.isConnected) {
      entry.restoreFocus.focus();
    }
  }

  return {
    show(id, screen, opts = {}) {
      unmount(id);

      const host = document.createElement('div');
      host.className = opts.overlay === true ? 'ui-screen ui-overlay' : 'ui-screen';
      host.dataset['screen'] = id;
      host.dataset['state'] = 'entering';
      if (opts.scrim === true) host.dataset['scrim'] = 'true';

      const restoreFocus = opts.overlay === true ? document.activeElement : null;
      root.appendChild(host);
      screen.mount(host);

      // Two frames of `entering` would be invisible in jsdom and unreliable in a
      // browser; instead force a reflow so the transition has a start value to
      // animate from, then flip to the resting state.
      void host.offsetHeight;
      host.dataset['state'] = 'active';

      // Mounting a screen focuses its first actionable element, so keyboard
      // players are never stranded with focus on <body>.
      const first = host.querySelector<HTMLElement>(
        'button:not([aria-disabled="true"]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      first?.focus();

      mounted.set(id, { screen, host, restoreFocus });
    },

    hide(id) {
      unmount(id);
    },

    get(id) {
      return mounted.get(id)?.screen;
    },

    dispose() {
      for (const id of [...mounted.keys()]) unmount(id);
      for (const timer of pendingRemovals) clearTimeout(timer);
      pendingRemovals.clear();
      root.replaceChildren();
    },
  };
}
