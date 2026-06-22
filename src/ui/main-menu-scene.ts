/**
 * Main Menu scene (docs/areas/07-main-menu.md). The navigation hub after Boot: a data-driven option
 * list (keyboard + pointer, wraparound, skipping disabled), the How-to-Play and Credits sub-panels
 * (in-scene overlays — Credits reuses the shared `credits-view` roster + scroll), an attract/idle
 * reel after `IDLE_TIMEOUT_S`, menu-in transition + selection bob, and menu music + nav SFX through
 * the Audio API. Settings-aware: reads persisted volume/mute + reduced-motion on enter (the scene is
 * re-created on every transition here, so returning from Settings re-reads automatically). Routing is
 * local — no gameplay event bus needed.
 */
import type { Scene } from '../state/scene';
import type { SceneManager } from '../state/scene-manager';
import type { InputEvent } from '../input/input';
import type { Renderer } from '../render/renderer';
import type { SettingsRepo } from '../persistence/settings-repo';
import type { HighscoresRepo } from '../persistence/highscores-repo';
import type { AudioEngineImpl } from '../audio/engine';
import { INTERNAL_WIDTH } from '../render/scaler';
import { drawSkyline } from '../render/backdrop';
import { MENU_ITEMS, TITLE, TAGLINE, FOOTER, HOW_TO_PLAY, ATTRACT_TEASER, type MenuItemId } from '../content/menu';
import { CREDITS } from '../content/credits';
import {
  createCreditsView,
  updateCredits,
  renderCredits,
  scrubCredits,
  pageCredits,
  type CreditsViewState,
} from './credits-view';
import { groupThousands } from './format';

export type MenuPanel = 'none' | 'howto' | 'credits' | 'attract';

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
}

const ATTRACT_CARD_S = 6;
const TRANSITION_IN_S = 0.3;
const SCRUB_STEP = 8;
const OPTIONS_Y0 = 100;
const ITEM_H = 18;
const CX = INTERNAL_WIDTH / 2;

function itemY(i: number): number {
  return OPTIONS_Y0 + i * ITEM_H;
}

export function createMainMenuScene(deps: MainMenuDeps): MainMenuScene {
  const idleTimeoutS = deps.idleTimeoutS ?? 20;
  const { sceneManager, audio, settings, highscores } = deps;

  // Animation/local state (not part of the cross-area scene contract).
  let transitionT = 0;
  let bobT = 0;
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

  function optionAt(x: number, y: number): number | null {
    for (let i = 0; i < self.items.length; i++) {
      const cy = itemY(i);
      if (x >= CX - 90 && x <= CX + 90 && y >= cy - 8 && y <= cy + 8) return i;
    }
    return null;
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

  function renderMenu(r: Renderer): void {
    drawSkyline(r);
    r.text(TITLE, CX, 38, { align: 'center', color: 'flash', font: 'font.display' });
    r.text(TAGLINE, CX, 54, { align: 'center', color: 'cream' });
    const slide = reducedMotion ? 0 : Math.round((1 - Math.min(1, transitionT / TRANSITION_IN_S)) * 40);
    self.items.forEach((it, i) => {
      const sel = i === self.selectedIndex;
      const bob = sel && !reducedMotion ? Math.round(Math.sin(bobT * 6) * 1.5) : 0;
      const color = !it.enabled ? 'concreteDk' : sel ? 'flash' : 'cream';
      if (sel) r.text('>', CX - 70 + slide, itemY(i) + bob, { color });
      r.text(it.label, CX + slide, itemY(i) + bob, { align: 'center', color });
    });
    r.text(FOOTER, CX, 206, { align: 'center', color: 'cream' });
    if (muted) r.text('MUTE', INTERNAL_WIDTH - 6, 8, { align: 'right', color: 'meterWarn' });
  }

  function renderHowTo(r: Renderer): void {
    drawSkyline(r, { dim: true });
    r.text('HOW TO PLAY', CX, 22, { align: 'center', color: 'accentPink', font: 'font.display' });
    HOW_TO_PLAY.forEach((line, i) => r.text(line, CX, 48 + i * 16, { align: 'center', color: 'cream' }));
    r.text('ESC / TAP TO GO BACK', CX, 200, { align: 'center', color: 'cream' });
  }

  function renderCreditsPanel(r: Renderer): void {
    drawSkyline(r, { dim: true });
    renderCredits(r, credits, CREDITS);
    r.text('ESC / TAP TO GO BACK', CX, 208, { align: 'center', color: 'cream' });
  }

  function renderAttract(r: Renderer): void {
    const drift = reducedMotion ? 0 : Math.round((attractCardT * 6) % 24);
    drawSkyline(r, { parallax: drift });
    if (attractCardIndex === 0) {
      r.text("TODAY'S HEROES", CX, 28, { align: 'center', color: 'accentPink', font: 'font.display' });
      highscores
        .list()
        .slice(0, 5)
        .forEach((e, i) => {
          const y = 60 + i * 16;
          r.text(`${i + 1}. ${e.name}`, 70, y, { color: 'cream' });
          r.text(groupThousands(e.score), 314, y, { align: 'right', color: 'rubleGold' });
        });
    } else {
      ATTRACT_TEASER.forEach((line, i) =>
        r.text(line, CX, 70 + i * 18, {
          align: 'center',
          color: i === 0 ? 'rubleGold' : 'cream',
          font: i === 0 ? 'font.display' : 'font.hud',
        }),
      );
    }
    r.text('PRESS ANY KEY', CX, 200, { align: 'center', color: 'cream' });
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
      transitionT = 0;
      bobT = 0;
      const s = settings.get();
      muted = s.muted;
      reducedMotion = s.accessibility.reducedMotion;
      audio.setScene('MainMenu');
    },

    update(dt: number): void {
      transitionT = Math.min(transitionT + dt, TRANSITION_IN_S);
      bobT += dt;
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

    render(r: Renderer): void {
      switch (self.panel) {
        case 'attract':
          renderAttract(r);
          break;
        case 'howto':
          renderHowTo(r);
          break;
        case 'credits':
          renderCreditsPanel(r);
          break;
        case 'none':
          renderMenu(r);
          break;
      }
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
      // Root menu.
      switch (e.type) {
        case 'aim': {
          const i = optionAt(e.world.x, e.world.y);
          if (i !== null) selectAt(i);
          break;
        }
        case 'pointer': {
          if (!e.down) break;
          const i = optionAt(e.world.x, e.world.y);
          if (i !== null) {
            selectAt(i);
            confirm(i);
          }
          break;
        }
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
        case 'fireUp':
          break;
      }
    },

    exit(): void {},
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
