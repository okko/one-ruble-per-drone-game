/**
 * Main Menu scene (docs/areas/07-main-menu.md). The navigation hub after Boot: a data-driven option
 * list (keyboard + pointer, wraparound, skipping disabled), the How-to-Play and Credits sub-panels
 * (in-scene panels — Credits reuses the shared `credits-view` scroll state), an attract/idle reel
 * after `IDLE_TIMEOUT_S`, and menu music + nav SFX through the Audio API. Settings-aware: reads
 * persisted volume/mute + reduced-motion on enter (the scene is re-created on every transition here,
 * so returning from Settings re-reads automatically). Routing is local — no gameplay event bus.
 *
 * The scene owns *what* is on screen; `ui/screens/main-menu-screen` owns the DOM. Pointer selection
 * and activation come back from real buttons, so no arena-coordinate hit-testing lives here.
 */
import type { Scene } from '../state/scene';
import type { SceneManager } from '../state/scene-manager';
import type { InputEvent } from '../input/input';
import type { SettingsRepo } from '../persistence/settings-repo';
import type { HighscoresRepo } from '../persistence/highscores-repo';
import type { AudioEngineImpl } from '../audio/engine';
import type { UiShell } from './shell/ui-shell';
import {
  createMainMenuScreen,
  type MainMenuVM,
  type AttractVM,
  type MenuPanel,
} from './screens/main-menu-screen';
import { MENU_ITEMS, TITLE, TAGLINE, FOOTER, HOW_TO_PLAY, ATTRACT_TEASER, type MenuItemId } from '../content/menu';
import { CREDITS } from '../content/credits';
import {
  createCreditsView,
  updateCredits,
  scrubCredits,
  pageCredits,
  type CreditsViewState,
} from './credits-view';
import { groupThousands } from './format';

export type { MenuPanel };

export interface MenuItem {
  id: MenuItemId;
  label: string;
  enabled: boolean;
  /** Routes via the SceneManager or opens an in-scene sub-panel. */
  activate: (sm: SceneManager) => void;
}

export interface MainMenuScene extends Scene {
  readonly items: ReadonlyArray<MenuItem>;
  selectedIndex: number;
  panel: MenuPanel;
  idleSeconds: number;
  moveSelection(delta: number): void;
  selectAt(index: number): void;
  confirm(index?: number): void;
  openPanel(panel: Exclude<MenuPanel, 'none'>): void;
  closePanel(): void;
}

export interface MainMenuDeps {
  sceneManager: SceneManager;
  audio: Pick<AudioEngineImpl, 'playSfx' | 'setScene'>;
  settings: SettingsRepo;
  highscores: HighscoresRepo;
  idleTimeoutS?: number;
  /** Absent in node tests, where navigation and routing are what is under test. */
  shell?: UiShell | undefined;
}

const ATTRACT_CARD_S = 6;
const SCRUB_STEP = 8;

export function createMainMenuScene(deps: MainMenuDeps): MainMenuScene {
  const idleTimeoutS = deps.idleTimeoutS ?? 20;
  const { sceneManager, audio, settings, highscores } = deps;

  // Animation/local state (not part of the cross-area scene contract).
  // The title bob is a CSS keyframe on the masthead, so no bob timer lives here.
  let attractCardT = 0;
  let attractCardIndex = 0;
  let muted = false;
  let reducedMotion = false;
  let credits: CreditsViewState = createCreditsView();

  function openPanel(panel: Exclude<MenuPanel, 'none'>): void {
    // The confirm cue is played by confirm() before activate() routes here, so no SFX is needed here.
    self.panel = panel;
    self.idleSeconds = 0;
    if (panel === 'credits') credits = createCreditsView();
  }

  function closePanel(): void {
    self.panel = 'none';
    self.idleSeconds = 0;
    audio.playSfx('uiSelect');
  }

  function moveSelection(delta: number): void {
    self.idleSeconds = 0;
    const n = self.items.length;
    let i = self.selectedIndex;
    for (let step = 0; step < n; step++) {
      i = (i + delta + n) % n;
      if (self.items[i]?.enabled) {
        if (i !== self.selectedIndex) {
          self.selectedIndex = i;
          audio.playSfx('uiSelect');
        }
        return;
      }
    }
  }

  function selectAt(index: number): void {
    const it = self.items[index];
    if (!it || !it.enabled) return;
    if (index !== self.selectedIndex) {
      self.selectedIndex = index;
      audio.playSfx('uiSelect');
    }
    self.idleSeconds = 0;
  }

  function confirm(index?: number): void {
    const i = index ?? self.selectedIndex;
    const it = self.items[i];
    if (!it || !it.enabled) return;
    audio.playSfx('uiConfirm');
    it.activate(sceneManager);
  }

  const items: MenuItem[] = MENU_ITEMS.map((m) => ({
    id: m.id,
    label: m.label,
    enabled: true,
    activate:
      m.id === 'start'
        ? (sm: SceneManager): void => sm.transition('Playing')
        : m.id === 'highscores'
          ? (sm: SceneManager): void => sm.transition('Highscores', {})
          : m.id === 'settings'
            ? (sm: SceneManager): void => sm.transition('Settings')
            : m.id === 'howto'
              ? (): void => openPanel('howto')
              : (): void => openPanel('credits'),
  }));

  const screen = deps.shell
    ? createMainMenuScreen({
        onSelect: (i) => selectAt(i),
        onConfirm: (i) => confirm(i),
        roster: CREDITS,
      })
    : undefined;

  function attractVM(): AttractVM {
    if (attractCardIndex === 0) {
      return {
        kind: 'scores',
        heading: "TODAY'S HEROES",
        rows: highscores
          .list()
          .slice(0, 5)
          .map((e) => ({ name: e.name, score: groupThousands(e.score) })),
      };
    }
    return { kind: 'teaser', lines: ATTRACT_TEASER };
  }

  function vm(): MainMenuVM {
    return {
      title: TITLE,
      tagline: TAGLINE,
      footer: self.panel === 'attract' ? 'PRESS ANY KEY' : FOOTER,
      items: self.items.map((it) => ({ id: it.id, label: it.label, enabled: it.enabled })),
      selectedIndex: self.selectedIndex,
      panel: self.panel,
      muted,
      howTo: HOW_TO_PLAY,
      creditsScrollY: credits.scrollY,
      attract: attractVM(),
    };
  }

  const self: MainMenuScene = {
    items,
    selectedIndex: 0,
    panel: 'none',
    idleSeconds: 0,
    moveSelection,
    selectAt,
    confirm,
    openPanel,
    closePanel,

    enter(): void {
      self.selectedIndex = 0;
      self.panel = 'none';
      self.idleSeconds = 0;
      const s = settings.get();
      muted = s.muted;
      reducedMotion = s.accessibility.reducedMotion;
      audio.setScene('MainMenu');
      if (deps.shell && screen) {
        deps.shell.show('main-menu', screen, { scrim: true });
        screen.update(vm());
      }
    },

    update(dt: number): void {
      self.idleSeconds += dt;
      if (self.panel === 'attract') {
        attractCardT += dt;
        if (attractCardT >= ATTRACT_CARD_S) {
          attractCardT = 0;
          attractCardIndex = (attractCardIndex + 1) % 2;
        }
      } else if (self.panel === 'credits') {
        updateCredits(credits, dt, CREDITS, { endBehavior: 'loop', reducedMotion });
      } else if (self.panel === 'none' && !reducedMotion && self.idleSeconds >= idleTimeoutS) {
        self.panel = 'attract';
        attractCardT = 0;
        attractCardIndex = 0;
      }
    },

    render(): void {
      screen?.update(vm());
    },

    onInput(e: InputEvent): void {
      self.idleSeconds = 0;
      // Attract mode: any input wakes the live menu and is consumed (never acts on an option).
      if (self.panel === 'attract') {
        self.panel = 'none';
        return;
      }
      if (self.panel === 'howto') {
        if (isBack(e)) closePanel();
        return;
      }
      if (self.panel === 'credits') {
        if (e.type === 'key' && e.down && (e.code === 'ArrowUp' || e.code === 'ArrowDown')) {
          const dir = e.code === 'ArrowUp' ? -1 : 1;
          if (reducedMotion) pageCredits(credits, dir, CREDITS);
          else scrubCredits(credits, -dir * SCRUB_STEP);
          return;
        }
        if (isBack(e)) closePanel();
        return;
      }
      // Root menu. Pointer selection and activation arrive as DOM events on the option
      // buttons themselves, so raw pointer events are not hit-tested here.
      switch (e.type) {
        case 'fireDown':
          confirm();
          break;
        case 'key': {
          if (!e.down) break;
          if (e.code === 'ArrowUp' || e.code === 'KeyW') moveSelection(-1);
          else if (e.code === 'ArrowDown' || e.code === 'KeyS') moveSelection(1);
          else if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') confirm();
          break;
        }
        case 'aim':
        case 'pointer':
        case 'fireUp':
          break;
      }
    },

    exit(): void {
      deps.shell?.hide('main-menu');
    },
  };

  return self;
}

/** A "back / confirm" gesture that closes an open sub-panel. */
function isBack(e: InputEvent): boolean {
  if (e.type === 'fireDown') return true;
  if (e.type === 'pointer') return e.down;
  if (e.type === 'key') return e.down && (e.code === 'Escape' || e.code === 'Enter' || e.code === 'Space' || e.code === 'NumpadEnter');
  return false;
}
