/**
 * Bootstrap + game loop driver. This is the ONLY module that reads the real clock
 * (`performance.now()`) and drives `requestAnimationFrame`; everything downstream receives a
 * fixed `dt` (docs/architecture.md §3, docs/areas/00-core-platform.md §3.2). It wires the core
 * substrate, persistence, render, input, and the scene manager together.
 */
import { createRng } from './core/rng';
import { createEventBus } from './core/events';
import { stepLoop } from './core/loop';
import { loadContent } from './content/loader';
import { createStorage } from './persistence/storage';
import { createMetaStatsRepo } from './persistence/meta-stats-repo';
import { createSettingsRepo } from './persistence/settings-repo';
import { createHighscoresRepo } from './persistence/highscores-repo';
import { wireGameOver } from './persistence/gameover-wiring';
import { createWebAudioBackend, type AudioSettings } from './audio/backend';
import { createAudioEngine } from './audio/engine';
import { createHudEconomy } from './ui/hud/economy-adapter';
import type { SettingsView } from './ui/hud/types';
import { createThreeView, type ThreeView } from './render/three/view';
import { createUiShell } from './ui/shell/ui-shell';
import { createGameOverlay } from './ui/game-overlay';
import { createInput } from './input/input';
import { createSceneManager } from './state/scene-manager';
import { createBootScene } from './state/boot-scene';
import { createPlayingScene } from './state/playing-scene';
import { createSettingsScene } from './state/settings-scene';
import { createGameOverScene } from './state/game-over-scene';
import { createMainMenuScene } from './ui/main-menu-scene';
import { createHighscoreEntryScene } from './ui/highscores/entry-scene';
import { createHighscoresListScene } from './ui/highscores/list-scene';
import manifestJson from './content/assets.manifest.json';
import type { SystemContext } from './core/system-context';
import type { GameState } from './state/game-state';

// Diagnostic hook for the cross-browser e2e (tests/e2e): live drone positions + the downing count,
// so the WebKit/iPhone smoke test can aim at a real drone and assert it was destroyed. Harmless in
// production; it only mirrors already-public game state.
declare global {
  interface Window {
    __combat?: { dronesDowned: number; drones: Array<{ x: number; y: number }>; aimAngle: number };
    // Mirrors the live AudioContext state for the WebKit unlock smoke (tests/e2e). Harmless in prod.
    __audio?: { readonly state: string };
    // Mirrors the active scene id for the shell smoke (tests/e2e/menu). Harmless in prod.
    __scene?: { readonly id: string };
  }
}

function main(): void {
  // The Three.js world renders to its own WebGL canvas at native resolution; the DOM UI layer sits
  // above it. Both are optional (absent host ⇒ headless-safe no-op). The portrait rotate prompt is
  // pure CSS (`@media (orientation: portrait)`), so nothing here drives it.
  const canvas3d = document.getElementById('game3d') as HTMLCanvasElement | null;
  const uiRoot = document.getElementById('ui');
  const hudHost = document.getElementById('hud');

  // Core substrate + injected context.
  const rng = createRng(0x1234abcd);
  const events = createEventBus();
  const content = loadContent({ manifest: manifestJson }); // throws loudly on malformed data
  const ctx: SystemContext = { rng, events, content };

  // Persistence.
  const storage = createStorage();
  const meta = createMetaStatsRepo(storage);
  const highscores = createHighscoresRepo(storage);
  const settingsRepo = createSettingsRepo(storage);
  const settings = settingsRepo.get();
  const settingsView: SettingsView = {
    reducedFlash: settings.accessibility.reducedFlash,
    largeHudText: settings.accessibility.largeHud,
    pauseWhilePanelOpen: settings.accessibility.pauseWhilePanelOpen,
    residentPanelKey: settings.bindings.residentPanel ?? 'KeyE',
  };
  const audioSettings: AudioSettings = {
    master: settings.masterVolume,
    music: settings.musicVolume,
    sfx: settings.sfxVolume,
    muted: settings.muted,
  };

  // Render + UI.
  //
  // The 3D view is created EAGERLY: the menu, the intro crane, and the pause pull-back are all
  // camera states of one continuous world, so there is no longer a moment in the app's life where
  // nothing 3D is on screen. `createThreeView` probes for WebGL2 silently and returns a working
  // no-op view when there is no context, which is what keeps the strict no-console-error smokes
  // clean on engines without GL.
  const view: ThreeView | undefined = canvas3d ? createThreeView(canvas3d, content) : undefined;
  const shell = uiRoot ? createUiShell(uiRoot) : undefined;
  const overlay = hudHost ? createGameOverlay(hudHost, content) : undefined;

  // Audio (area 06): the real Web Audio backend behind the injectable seam; SFX + music wired to the
  // event bus. Stays suspended until the first user gesture unlocks it (iOS-safe, below).
  const audioBackend = createWebAudioBackend();
  const audio = createAudioEngine(content.audio);
  audio.init(audioBackend, audioSettings);
  audio.bind(events);
  window.__audio = {
    get state(): string {
      return audioBackend.state;
    },
  };

  // HUD (area 10): the economy selector adapter the resident panel reads.
  const hudEconomy = createHudEconomy(content);

  // Scene machine + the reachable scenes (Phase 5 shell). The Gameplay Engine (area 01) owns Playing;
  // the Main Menu (07), Highscores entry/list (08), and the Settings stub now wrap it, and GameOver
  // (08) qualifies the finished run and routes to name entry or the list. `wireGameOver` records the
  // run + transitions to GameOver, which recovers the full run summary from `meta.lastRun`.
  const combatDebug: NonNullable<Window['__combat']> = { dronesDowned: 0, drones: [], aimAngle: 0 };
  window.__combat = combatDebug;
  const onState = (gs: GameState): void => {
    combatDebug.dronesDowned = gs.combat.dronesDowned;
    combatDebug.drones = gs.combat.drones.map((d) => ({ x: d.pos.x, y: d.pos.y }));
    combatDebug.aimAngle = gs.combat.aim.effectiveAngle;
  };

  const manager = createSceneManager(ctx, 'Boot');
  window.__scene = {
    get id(): string {
      return manager.active;
    },
  };
  manager.register('Boot', () => createBootScene(manager, meta));
  manager.register('MainMenu', () =>
    createMainMenuScene({ sceneManager: manager, audio, settings: settingsRepo, highscores, shell }),
  );
  manager.register('Playing', () =>
    createPlayingScene({ onState, audio, view, overlay, economy: hudEconomy, settings: settingsView }),
  );
  manager.register('Settings', () => createSettingsScene({ sceneManager: manager, shell }));
  manager.register('GameOver', () =>
    createGameOverScene({ sceneManager: manager, repo: highscores, meta, audio, shell }),
  );
  manager.register('HighscoreEntry', () =>
    createHighscoreEntryScene({
      sceneManager: manager,
      repo: highscores,
      now: () => new Date().toISOString(),
      audio,
      shell,
    }),
  );
  manager.register('Highscores', () =>
    createHighscoresListScene({ sceneManager: manager, repo: highscores, audio, shell }),
  );
  wireGameOver(events, manager, meta);

  // Input. Aim and fire come off the 3D canvas via the view's fixed aim camera; the keyboard is
  // bound here too, so menus and gameplay share one event stream and no keystroke is delivered
  // twice. UI buttons handle their own clicks and are unaffected.
  if (canvas3d) {
    createInput(
      canvas3d,
      { screenToWorld: (sx, sy) => (view ? view.screenToWorld(sx, sy) : { x: 192, y: 108 }) },
      {
        onEvent: (e) => manager.routeInput(e),
        // iOS unlocks the AudioContext only from a synchronous in-gesture resume (compatibility.md §5).
        onFirstGesture: () => {
          void audio.unlock();
        },
      },
    );
  }

  // Viewport: drive resize from visualViewport (handles the iOS URL-bar reflow). The rotate overlay
  // is CSS-driven; only the 3D surface needs telling.
  const resize = (): void => {
    const vw = window.visualViewport?.width ?? window.innerWidth;
    const vh = window.visualViewport?.height ?? window.innerHeight;
    view?.resize(vw, vh);
  };
  resize();
  window.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);

  // Auto-pause when backgrounded (docs/compatibility.md §5).
  let paused = false;
  document.addEventListener('visibilitychange', () => {
    paused = document.hidden;
    audio.onVisibilityChange(document.hidden); // quiesce when hidden; resume() on return (06 §3.2a)
  });
  window.addEventListener('pagehide', () => {
    paused = true;
    audio.onVisibilityChange(true);
  });

  // Fixed-timestep loop; logic only ever sees a constant dt via stepLoop.
  let accumulator = 0;
  let alpha = 0;
  let prev = performance.now();
  // Every shell scene wants the same slow cinematic orbit behind its panels; only Playing drives
  // its own camera (intro crane, then shooting, then interior). Deriving the state from the active
  // scene here keeps five scene modules free of a ThreeView dependency they would otherwise only
  // use for one line each — and the director blends, so a transition is never a cut.
  let cameraScene = '';
  const frame = (now: number): void => {
    const frameDt = (now - prev) / 1000;
    prev = now;
    if (!paused) {
      const step = stepLoop(accumulator, frameDt, (dt) => manager.update(dt, ctx));
      accumulator = step.accumulator;
      alpha = step.alpha;
    }
    if (manager.active !== cameraScene) {
      cameraScene = manager.active;
      if (cameraScene !== 'Playing') view?.setCameraState('menu');
    }
    manager.render(alpha);
    // The DOM HUD shows only while Playing; the 3D world is continuous, and the scene picks the
    // camera state for it.
    if (hudHost) hudHost.style.display = manager.active === 'Playing' ? 'block' : 'none';
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main();
