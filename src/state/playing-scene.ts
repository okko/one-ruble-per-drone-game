/**
 * The Playing scene (docs/areas/01-gameplay-engine.md §3.1, §request). A THIN shell over the pure
 * engine: it owns the run's `GameState`, drives `engine.step` each tick, and renders the run through the
 * Three.js world view + the DOM HUD overlay (the old Canvas-2D in-game UI is gone). All gameplay logic
 * stays in `src/systems/combat/*`; this file adapts the Scene/Input edges and owns the SHOOTING ⇄
 * INTERIOR mode machine:
 *  - SHOOTING: aim + fire at the drones (pointer/touch or A/D + Space), exactly as before.
 *  - INTERIOR: press E to leave the firing post and step down inside the tower; ↑/↓ walk floors, ←/→
 *    pick a resident interaction, ENTER buys/begs it (routed as a `residentIntent`); stepping back up
 *    onto the roof (or E again) returns to SHOOTING. The sim keeps running, so being inside during a
 *    wave is a real risk — that is why drones arrive in spaced waves with a siren.
 * It does NOT handle `gameOver` (the global `wireGameOver` routes to the GameOver scene).
 */
import { createGameState } from './create-game-state';
import { createEngine } from '../systems/combat/engine';
import { IDLE_INTENT } from '../systems/combat/types';
import type { Engine } from '../systems/combat/engine';
import type { PlayerIntent } from '../systems/combat/types';
import type { AudioEngineImpl } from '../audio/engine';
import type { Scene } from './scene';
import type { SystemContext } from '../core/system-context';
import type { InputEvent } from '../input/input';
import type { Renderer } from '../render/renderer';
import type { ResidentDef } from '../content/residents';
import type { GameState } from './game-state';
import type { Vec2 } from '../core/math';
import type { ThreeView } from '../render/three/view';
import type { GameOverlay } from '../ui/game-overlay';
import type { HudEconomy, SettingsView, ResidentMenuEntry } from '../ui/hud/types';
import type { InteriorOption, PlayingViewState, PlayMode } from './playing-view';

const TOP_FLOOR = 32; // the firing-post roof sits atop floor 32
const BOTTOM_FLOOR = 21; // residents occupy the top 12 floors (21–32)

const NAV_UP = new Set(['ArrowUp', 'KeyW']);
const NAV_DOWN = new Set(['ArrowDown', 'KeyS']);
const NAV_LEFT = new Set(['ArrowLeft', 'KeyA']);
const NAV_RIGHT = new Set(['ArrowRight', 'KeyD']);
const CONFIRM = new Set(['Enter', 'NumpadEnter', 'Space']);

export interface PlayingSceneOptions {
  /** Per-tick diagnostic sink used by the cross-browser e2e (`__combat`). */
  onState?: (gs: GameState) => void;
  /** Audio engine (area 06): advanced per tick + told the active scene. */
  audio?: Pick<AudioEngineImpl, 'update' | 'setScene'>;
  /** The Three.js world view (omitted in headless tests — the engine still runs). */
  view?: ThreeView | undefined;
  /** The DOM HUD + interaction overlay (omitted in headless tests). */
  overlay?: GameOverlay | undefined;
  /** Economy selector for the resident-interaction menu (omitted in bare-engine tests). */
  economy?: HudEconomy;
  /** Settings projection (resident-panel key binding + pause-while-visiting accessibility). */
  settings?: SettingsView;
}

export function createPlayingScene(opts: PlayingSceneOptions = {}): Scene {
  let gs: GameState | null = null;
  let engine: Engine | null = null;
  const occupantByFloor = new Map<number, ResidentDef>();

  // Buffered shooting input.
  let aimTarget: Vec2 | null = null;
  let fireHeld = false;
  let left = false;
  let right = false;

  // Interaction state.
  let mode: PlayMode = 'shooting';
  let floor = TOP_FLOOR;
  let selected = 0;
  let cachedOptions: InteriorOption[] = [];

  const panelKey = (): string => opts.settings?.residentPanelKey ?? 'KeyE';

  function currentResidentEntry(): ResidentMenuEntry | null {
    const occ = occupantByFloor.get(floor);
    if (!occ || !gs || !opts.economy) return null;
    return opts.economy.getAvailableInteractions(gs).residents.find((r) => r.residentId === occ.id) ?? null;
  }

  function buildOptions(): InteriorOption[] {
    const entry = currentResidentEntry();
    if (!entry) return [];
    return [
      ...entry.services.map((o) => ({ residentId: entry.residentId, kind: 'service' as const, option: o })),
      ...entry.favors.map((o) => ({ residentId: entry.residentId, kind: 'favor' as const, option: o })),
    ];
  }

  function enterInterior(): void {
    mode = 'interior';
    floor = TOP_FLOOR;
    selected = 0;
    // Stepping inside drops the trigger so the gun never sticks on while we walk down.
    fireHeld = false;
    left = false;
    right = false;
  }
  function backToShooting(): void {
    mode = 'shooting';
    floor = TOP_FLOOR;
  }

  // Routed through the event bus exactly like the old intercom panel; the engine consumes the intent.
  let emitIntent: (e: { kind: 'buyService'; residentId: string; serviceId: string } | { kind: 'begFavor'; residentId: string; favorId: string }) => void = () => {};

  function confirmSelection(): void {
    const choice = cachedOptions[selected];
    if (!choice || choice.option.disabledReason !== undefined) return; // greyed entries are non-selectable
    if (choice.kind === 'service') {
      emitIntent({ kind: 'buyService', residentId: choice.residentId, serviceId: choice.option.id });
    } else {
      emitIntent({ kind: 'begFavor', residentId: choice.residentId, favorId: choice.option.id });
    }
  }

  function handleInteriorKey(code: string): void {
    if (NAV_DOWN.has(code)) {
      floor = Math.max(BOTTOM_FLOOR, floor - 1);
      selected = 0;
    } else if (NAV_UP.has(code)) {
      const next = floor + 1;
      if (next > TOP_FLOOR) backToShooting();
      else {
        floor = next;
        selected = 0;
      }
    } else if (NAV_LEFT.has(code)) {
      selected = Math.max(0, selected - 1);
    } else if (NAV_RIGHT.has(code)) {
      selected = Math.min(Math.max(0, cachedOptions.length - 1), selected + 1);
    } else if (CONFIRM.has(code)) {
      confirmSelection();
    }
  }

  function viewState(): PlayingViewState {
    cachedOptions = mode === 'interior' ? buildOptions() : [];
    if (selected >= cachedOptions.length) selected = Math.max(0, cachedOptions.length - 1);
    const occ = occupantByFloor.get(floor);
    const w = gs?.combat.waves;
    const sirenActive = w?.phase === 'siren';
    const secondsUntilWave = !w || w.phase === 'active' ? null : Math.max(0, w.timer);
    return {
      mode,
      floor,
      topFloor: TOP_FLOOR,
      bottomFloor: BOTTOM_FLOOR,
      storeys: TOP_FLOOR,
      occupants: [...occupantByFloor].map(([f, r]) => ({ floor: f, id: r.id, name: r.name })),
      currentResidentId: occ?.id ?? null,
      currentResidentName: occ?.name ?? null,
      options: cachedOptions,
      selected,
      siren: { active: sirenActive, secondsUntilWave },
    };
  }

  return {
    enter(_params: void, ctx: SystemContext): void {
      gs = createGameState(ctx.content, ctx.rng.getState().seed);
      engine = createEngine(gs, ctx);
      occupantByFloor.clear();
      for (const r of ctx.content.economy.roster) occupantByFloor.set(r.floor, r);
      emitIntent = (e): void => ctx.events.emit('residentIntent', e);
      mode = 'shooting';
      floor = TOP_FLOOR;
      selected = 0;
      opts.audio?.setScene('Playing');
      opts.overlay?.setVisible(true);
      opts.view?.setVisible(true);
    },

    update(dt: number): void {
      if (!gs || !engine) return;
      // Accessibility: optionally freeze the sim while inside (otherwise a wave can hit while visiting).
      const paused = mode === 'interior' && (opts.settings?.pauseWhilePanelOpen ?? false);
      if (!paused) {
        const intent: PlayerIntent =
          mode === 'interior'
            ? IDLE_INTENT
            : { aimTarget, rotateDir: (right ? 1 : 0) - (left ? 1 : 0), fireHeld };
        engine.step(dt, intent);
      }
      opts.audio?.update(gs, dt);
      opts.onState?.(gs);
    },

    onInput(e: InputEvent): void {
      if (e.type === 'key') {
        if (e.code === panelKey()) {
          if (e.down) {
            if (mode === 'shooting') enterInterior();
            else backToShooting();
          }
          return;
        }
        if (mode === 'interior') {
          if (e.down) handleInteriorKey(e.code);
          return; // interior consumes all keys (never steers the gun)
        }
        if (e.code === 'Space') fireHeld = e.down;
        else if (NAV_LEFT.has(e.code)) left = e.down;
        else if (NAV_RIGHT.has(e.code)) right = e.down;
        return;
      }
      if (mode === 'interior') return; // ignore aim/fire while inside
      switch (e.type) {
        case 'aim':
          aimTarget = e.world;
          break;
        case 'pointer':
          if (e.down) aimTarget = e.world;
          break;
        case 'fireDown':
          fireHeld = true;
          break;
        case 'fireUp':
          fireHeld = false;
          break;
      }
    },

    render(r: Renderer): void {
      if (!gs) return;
      const vs = viewState();
      opts.view?.render(gs, r.alpha, vs);
      opts.overlay?.update(gs, vs);
    },

    exit(): void {
      engine?.dispose();
      engine = null;
      opts.audio?.setScene('MainMenu');
      opts.overlay?.setVisible(false);
      opts.view?.setVisible(false);
      gs = null;
    },
  };
}
