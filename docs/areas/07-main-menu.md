# Area: Main Menu

**Owner:** <unassigned> · **Depends on:** Core Platform & Build, State & Persistence, Art & Visual Style, Audio · **Depended on by:** (entry point for) Highscores, Settings, Gameplay Engine

## 1. Purpose

This area owns the **MainMenu scene** and the surrounding "menu shell" — the first
screen the player sees after Boot, the navigation hub that routes to every other
top-level scene (Playing, Highscores, Settings, How to Play, Credits), and the
attract/idle loop that runs when the game is left untouched. It establishes the
cheerful 16-bit first impression and the input/feel conventions reused by the other
menu-style scenes.

## 2. Scope

### In scope
- The `MainMenu` scene implementing the `Scene` contract (`enter/update/render/exit/onInput`).
- Title presentation (logo, tagline, version, parallax skyline backdrop hookup).
- The menu option list, selection model, and navigation (keyboard + mouse).
- Routing each option to the correct scene via the `SceneManager`.
- The **How to Play** instructions panel and **Credits** panel (sub-views of this scene).
- Attract/idle mode (auto-cycling reel) after an inactivity timeout.
- Scene-transition animations into/out of the menu.
- Triggering menu music and menu navigation SFX through the Audio API.
- Reading persisted Settings to display correct state (e.g. mute glyph) and to know
  whether the first-run intro should auto-play.

### Out of scope (owned elsewhere)
- The `SceneManager` skeleton and `Scene` interface — **Core/State** (`state/`).
- The Settings scene contents and the Highscores list/entry scenes — **Settings**
  area and **Highscores** area. MainMenu only routes to them.
- Final pixel art for the logo, fonts, and skyline sprites — **Art & Visual Style**
  (this doc specifies layout and intent; Art supplies assets).
- Music tracks and SFX samples — **Audio** (this doc specifies cue points/triggers).
- Persistence implementation — **State & Persistence** (this doc only reads settings).

## 3. Requirements & mechanics

1. **Scene lifecycle.** `MainMenu` implements `{ enter(ctx), update(dt, ctx),
   render(r), exit(), onInput(e) }` and is the scene the `SceneManager` activates
   after `Boot` completes (per architecture.md §6).
   - `enter()`: reset selection to the first enabled option, reset the idle timer,
     request the menu music track (fade-in), kick off the menu-in transition.
   - `update(dt)`: advance parallax/idle animations, advance the idle timer, drive
     transition tweens, and advance attract mode when active.
   - `render(r)`: draw backdrop → title → tagline → option list → footer; or the
     active sub-panel (How to Play / Credits) when open; or the attract reel.
   - `exit()`: stop accepting input, fade menu music as appropriate for the target
     scene (Playing gets a hard cut to gameplay music; sibling menus keep music).
2. **Title presentation.**
   - Bright 16-bit logo treatment for **"One Ruble Per Drone"** rendered over the
     parallax Moscow skyline backdrop (reuse the gameplay background renderer from
     Art where possible so the menu and game feel continuous).
   - **Tagline** beneath the logo, cheerful-but-grim, e.g. *"A ruble a drone — what
     a deal!"* Keep it relentlessly upbeat per the GDD tone rules. (Final copy with lead.)
   - Build/version string and a "© residents of the 23rd floor" style footer credit
     (placeholder, finalize with Credits copy).
3. **Menu options & routing.** Default ordered list (data-driven so order/labels are
   easy to tune):

   | # | Label | Action |
   |---|---|---|
   | 1 | **Start New Shift** | `SceneManager.goto('Playing')` (begin a fresh run) |
   | 2 | **Highscores** | `goto('Highscores')` |
   | 3 | **Settings** | `goto('Settings')` |
   | 4 | **How to Play** | open the How-to-Play sub-panel (in-scene overlay) |
   | 5 | **Credits** | open the Credits sub-panel (in-scene overlay) |

   Options are defined as `MenuItem[]` (see §4) with an `enabled` flag so an item can
   be greyed out (e.g. Highscores disabled until at least one score exists — optional).
4. **Navigation model.**
   - **Keyboard:** Up/Down (and W/S) move the selection with **wraparound** (top↔bottom),
     skipping disabled items; Enter/Space activates the selected item; Escape closes
     an open sub-panel (How to Play / Credits) and otherwise does nothing on the root.
   - **Mouse:** hovering an option sets the selection to it; clicking activates it.
     Hover and keyboard share one `selectedIndex` so they never desync.
   - Any input resets the idle timer and, if attract mode is active, exits attract
     mode back to the live menu (the input that woke it is consumed, not acted on).
5. **Selection highlight.** The selected option is visually emphasized (color shift +
   a chunky pixel cursor/chevron + a subtle bob animation). Disabled options render
   dimmed and are not selectable.
6. **How to Play panel.** A single concise in-scene overlay summarizing: aim & fire
   the gun to down drones (+1 ₽ each), keep your five needs (😴 💩 🍞 💧 🚬) out of
   the red, buy services with rubles or beg favors when broke, survive incidents, and
   chase the pinball-style score. Escape/Back returns to the menu. Keep it one
   screen, illustrated with the real HUD icons (coordinate with HUD & Art).
7. **Credits panel.** Scrolling or paged credits, cheerful tone. Escape/Back returns.
8. **Attract / idle mode.** After **20 s** (tunable constant `IDLE_TIMEOUT_S`) of no
   input on the root menu, enter attract mode: a looping reel that cycles between
   (a) a **highscore reel** (top entries pulled from the Highscores repo) and (b) a
   short **demo/teaser** card (e.g. animated skyline with drones streaking by and the
   tagline). Each card shows for ~6 s then crossfades to the next; loops until any
   input wakes it. Attract mode never starts gameplay on its own.
9. **Transitions.** A short (~0.3 s) menu-in animation on `enter()` (logo drops in,
   options stagger in) and a menu-out animation on `exit()` appropriate to the
   destination (wipe to gameplay for Start; quick fade for sibling menus). Transitions
   are time-driven via `dt` and skippable by input.
10. **Settings-aware display.** On `enter()` and when returning from Settings, read
    the persisted settings to render the correct mute/volume glyph and to honor a
    "reduced motion" accessibility flag (disables the bob/attract animations, keeps
    crossfades minimal). If a "seen intro" meta flag is false on first ever boot, the
    menu may auto-open the How to Play panel once (then set the flag via Persistence).
11. **Audio cues.** Request the looping menu music on `enter()` (fade-in). Play a
    "move" SFX on selection change and a "confirm" SFX on activation; a soft "back"
    SFX on closing a panel. All via the Audio area's API; no direct Web Audio here.

## 4. Public interface (TypeScript)

```ts
// src/ui/main-menu-scene.ts
import type { Scene, SceneManager, SystemContext } from '../state';

export interface MenuItem {
  id: 'start' | 'highscores' | 'settings' | 'howto' | 'credits';
  label: string;
  enabled: boolean;
  /** Invoked on activation; routes via SceneManager or opens a sub-panel. */
  activate(sm: SceneManager, scene: MainMenuScene): void;
}

export type MenuPanel = 'none' | 'howto' | 'credits' | 'attract';

export interface MainMenuScene extends Scene {
  readonly items: ReadonlyArray<MenuItem>;
  selectedIndex: number;
  panel: MenuPanel;
  idleSeconds: number;
  /** Move selection by ±1 with wraparound, skipping disabled items. */
  moveSelection(delta: number): void;
  /** Set selection from a pointer hover/click hit-test (no-op if index disabled). */
  selectAt(index: number): void;
  /** Activate the current selection (or the given index). */
  confirm(index?: number): void;
  openPanel(panel: Exclude<MenuPanel, 'none'>): void;
  closePanel(): void;
}

export function createMainMenuScene(deps: {
  sceneManager: SceneManager;
  audio: AudioApi;          // from Audio area
  settings: SettingsRepo;   // from State & Persistence
  highscores: HighscoreRepo;// from Highscores (for attract reel)
  idleTimeoutS?: number;    // default IDLE_TIMEOUT_S = 20
}): MainMenuScene;
```

Consumes the `SceneManager`/`Scene` contracts from `state/` (architecture.md §6) and
the renderer `r` passed to `render`.

## 5. Data / content tables

- The default `MenuItem[]` ordering/labels (above). Stored as a small typed array in
  `src/ui/main-menu-scene.ts` (or `src/content/menu.ts` if shared). No balance tables.
- How-to-Play and Credits copy are static strings (final wording approved by lead).

## 6. Persistence

- **Reads** settings (volume/mute, reduced-motion) and the `seenIntro` meta flag via
  the Persistence repos. **Writes** only `seenIntro = true` after the first-run
  How-to-Play auto-open. All other settings writes belong to the Settings scene.

## 7. Dependencies & integration

- **Consumes:** `SceneManager` (routing), `AudioApi` (music + nav SFX), `SettingsRepo`
  and meta flags (Persistence), `HighscoreRepo` (attract reel data), the renderer and
  parallax background (Art/Render).
- **Emits/observes events:** none required on the gameplay event bus; navigation is
  local. May emit a lightweight `menuAction` for analytics later (optional).
- **Injected ctx:** uses `ctx` only for the shared clock/`dt`; no RNG needed except a
  cosmetic seed for attract animation variety (use injected `rng`, not `Math.random`).

## 8. Required automated tests (MUST pass)

Vitest under `jsdom`. All must pass per architecture.md §7 (`npm run check` green).

1. **Renders all options.** `render()` (against a fake canvas/text-capture renderer)
   produces all five expected option labels in order.
2. **Keyboard navigation moves selection.** Down advances `selectedIndex`; Up
   retreats it.
3. **Wraparound.** Up from the first item lands on the last; Down from the last lands
   on the first; disabled items are skipped during traversal.
4. **Mouse hover sets selection.** A hover hit-test on an option updates
   `selectedIndex` to that option; hover on a disabled item is a no-op.
5. **Start routes to Playing.** Confirming "Start New Shift" calls
   `SceneManager.goto('Playing')` exactly once.
6. **Routing for siblings.** Confirming Highscores → `goto('Highscores')`; Settings →
   `goto('Settings')`; each fires exactly once with the right target.
7. **Panels open/close.** Confirming How to Play sets `panel === 'howto'`; Credits
   sets `panel === 'credits'`; Escape returns `panel` to `'none'` without changing
   scene.
8. **Attract mode engages on idle.** Advancing `update(dt)` past `IDLE_TIMEOUT_S`
   with no input sets `panel === 'attract'`; a subsequent input exits attract mode
   (back to `'none'`) and does **not** trigger an option's action.
9. **Audio cues fire.** Selection change calls the audio "move" cue; confirm calls the
   "confirm" cue (assert against a mock `AudioApi`).
10. **Settings-aware render.** With a mocked `SettingsRepo` reporting muted, the menu
    renders the muted glyph; with `reducedMotion`, attract/bob animation flags are off.

Tests must use injected `dt`, a mock `SceneManager`, mock `AudioApi`, and an
in-memory `SettingsRepo`/`HighscoreRepo` — no real timers, audio, or `localStorage`.

## 9. Acceptance criteria / Definition of done

- [ ] `MainMenu` scene implements the `Scene` contract and is reachable from Boot.
- [ ] All five options render, navigate (keyboard + mouse, with wraparound), and
      route correctly.
- [ ] How to Play and Credits panels open and close via keyboard and mouse.
- [ ] Attract mode engages after the idle timeout and wakes on input without
      side-effecting the menu.
- [ ] Menu music and navigation SFX trigger through the Audio API.
- [ ] Menu honors persisted volume/mute and reduced-motion settings.
- [ ] All required tests authored and passing; `npm run check` green; no `any` w/o
      justification (global DoD, architecture.md §9).

## 10. Open questions / risks

- Should Highscores be disabled when no scores exist, or always shown with an "empty"
  state? (Lean: always shown; Highscores area defines the empty state.)
- Attract demo: a true gameplay demo (replay of a seeded run) vs. a scripted teaser.
  Replay is cooler but couples to the Gameplay Engine's determinism; recommend
  starting with a scripted teaser and upgrading to a seeded replay if time allows.
- First-run auto-open of How to Play — confirm desired with lead/UX.
