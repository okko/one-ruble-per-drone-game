# Area: HUD & In-game UI

**Owner:** <unassigned> · **Depends on:** Core Platform (input, event bus), Gameplay
Status / Meters, Economy & Residents (available-interactions selector + intent
contract), Scoring, Gameplay Engine, Random Incidents, Art & Visual Style (the 3D
backdrop + camera states this layer sits over), State & Persistence (Settings view)
· **Depended on by:** every scene — this area owns the entire user interface

## 1. Purpose

This area owns **the whole user interface**: the in-game HUD, the resident
interaction panel, and every shell screen (main menu, settings, pause, game over,
highscore entry and list, credits). It also owns the **design system** — the CSS
design tokens, typography, spacing, motion, and focus semantics — that keeps all of
them coherent.

The UI is **DOM and CSS**, composited over the live three.js scene (area 11). It is a
pure presentation + intent layer: it **reads** `GameState` and view models and
**emits player intents**, and never mutates gameplay state.

> **Superseded:** the previous Canvas-2D HUD drawn at 384×216 into a sprite-atlas
> renderer has been retired, along with the pixel-art meter icons and the bitmap
> font. UI is DOM at native resolution.

**Why DOM and not in-scene 3D text.** The UI must be crisp at any device pixel ratio,
keyboard-navigable, screen-reader-addressable, and directly assertable in Playwright.
DOM gives all of that for free; 3D text gives none of it and would need a
text-rendering dependency. The 3D scene provides the *atmosphere*; the DOM provides
the *interface*.

## 2. Scope

### In scope
- The **design system**: `src/ui/styles/tokens.css` (colour, type scale, spacing,
  radii, elevation, easing, durations) plus the shared stylesheets.
- The **UI shell runtime** (`src/ui/shell/`): screen registry, mount/unmount, enter
  and exit transitions, focus management, and the **pure list-navigation model**.
- The **in-game HUD**: five need meters, rubles, debt, score, combo, city integrity,
  wave/siren banner, incident banner, transaction feedback.
- The **resident interaction panel** and the intents it emits.
- Every **shell screen** in `src/ui/screens/`.
- **Input routing** between the UI and the gun, and input parity across keyboard,
  pointer, and touch.
- **Accessibility**: reduced flashing, reduced motion, larger UI text, focus
  visibility, tap-target sizes, safe-area insets.

### Out of scope (owned elsewhere)
- Computing meter values, thresholds, or crisis rules → **Meters**.
- Computing which services/favors are available, prices, gating, and outcomes →
  **Economy & Residents**. This area renders the list it is *given* and emits an
  intent; it applies no economy rule.
- Score/combo math → **Scoring**. Simulation and the `Playing` lifecycle →
  **Gameplay Engine**.
- The 3D scene, its materials, lighting, and camera poses → **Art & Visual Style**.
  This area *requests* a camera state; it does not position cameras.
- The localStorage schema for settings → **State & Persistence**.

## 3. Requirements & mechanics

### 3.1 Layer structure & layout

```
#game3d   — the live three.js scene, full viewport, always visible          (z 1)
#ui       — the DOM UI root, full viewport, pointer-events: none            (z 2)
  └─ .screen        one mounted shell screen (menu / settings / …), or none
  └─ .hud           the in-game HUD, mounted only while Playing
  └─ .overlay       pause, dialogs, toasts — stacked above a screen
#rotate-overlay — portrait prompt                                          (z 10)
```

**`#ui` is `pointer-events: none` by default.** Only interactive elements — buttons,
menu rows, the resident panel, the intercom button — opt back in with
`pointer-events: auto`. A full-screen transparent container that eats `pointerdown`
silently breaks aiming, and is a required test case (§8).

**HUD layout** frames the viewport edges and keeps the centre clear for aiming:

| Region | Contents |
|---|---|
| Top-left | The five need meters, stacked in fixed order |
| Top-centre | Wave / air-raid siren banner; incident banner |
| Top-right | Score, with the combo multiplier beneath it |
| Bottom-left | Ruble counter; debt line when `debt > 0` |
| Bottom-centre | City-integrity bar |
| Bottom-right | Controls hint; intercom button on touch |
| Right ~40% | Resident interaction panel, when open |

All regions are laid out with CSS Grid against the viewport and padded with
`env(safe-area-inset-*)`, so the notch and home indicator never cover anything
readable or tappable. The layout is **fluid**, not fixed-pixel: it reflows for
phone, tablet, and desktop rather than scaling a fixed canvas.

### 3.1b Design tokens

Every colour, size, spacing step, radius, shadow, duration, and easing curve is a CSS
custom property in `src/ui/styles/tokens.css`. Rules:

- **No hard-coded visual values in TypeScript.** Screens set classes and data
  attributes; CSS owns appearance. A hex code or a pixel size in a `.ts` file is a
  review failure.
- **Type scale is fluid** (`clamp()`), so text is readable on a phone and not comical
  on a 4K display, without JS measurement.
- **Colour tokens are semantic** (`--c-surface`, `--c-accent`, `--c-danger`), and are
  mirrored by `src/render/three/theme.ts` so the UI and the world agree.
- **Motion tokens** (`--dur-fast`, `--ease-out`) are the only place timings live, so
  `reducedMotion` can neutralise them in one rule.

### 3.1c Screens & transitions

The shell owns a registry of screens; the `SceneManager` drives which one is mounted.
A screen implements `{ mount(root), update(vm), unmount() }` and owns no game logic.

- Entering and leaving a screen is an **eased transition**, not a cut — and it is
  choreographed with the camera: entering the main menu requests the `menu` camera
  state, starting a run requests `intro`, opening pause requests `pause`.
- Screens are **keyboard-first**: up/down move, confirm activates, cancel goes back.
  Pointer and touch drive the same model, so behaviour cannot diverge between inputs.
- The list-navigation model (`src/ui/shell/menu-model.ts`) is **pure**: wrap-around,
  skipping disabled entries, and clamping are unit-tested without a DOM.

### 3.2 The five meter widgets

- One widget per meter, stacked top-left in fixed order: **😴 Sleep, 🍞 Hunger,
  💧 Thirst, 🚬 Vice, 💩 Poo**. Icons are **system emoji** rendered through the
  documented font stack (`compatibility.md §2`) — DOM at native resolution, so the
  old ban on emoji (a canvas-blur and pixel-consistency concern) no longer applies.
  Per-engine glyph artwork differs; that is accepted and must be masked in any
  screenshot assertion.
- Each widget = `[icon][bar]`. The bar **fills toward danger** (0 = empty/safe,
  100 = full/crisis), matching the meters convention. Fill width is proportional to
  the value and animates via a CSS transition, not a per-frame JS write.
- **Colour state is read from the Meters slice**, not recomputed here: green while
  `value < warn`, amber while `warn ≤ value < crisis`, red at crisis. The HUD reads
  `meter.value`, `meter.warn`, and the crisis flag; it decides no thresholds.
- The active-debuff context (e.g. drunk, micro-sleep) is surfaced as a small
  annotation on the relevant meter when the Meters slice reports it, so the player
  can read *why* aiming feels off.

### 3.3 Rubles, debt, city integrity

- **Ruble counter** (`₽ <n>`) bottom-left. On `rublesChanged` with a positive delta it
  plays a **cash-change animation**: a floating `+<delta>` that rises and fades plus a
  quick scale-bounce of the counter; the audio area plays the cash register off the
  same event. Negative deltas (spending, debt repayment) flash the counter and float
  a `-<delta>`.
- **Debt indicator**: hidden when `player.debt === 0`; when `debt > 0` it shows
  `DEBT ₽-<n>` in the danger colour beneath the ruble counter and pulses while a kill
  is repaying it.
- **City integrity**: a bottom-centre bar reflecting how much of the skyline is still
  standing. Unlike the need meters it **depletes** (full = healthy); colour shifts
  good → warn → danger as it falls, and it shakes briefly when a drone gets through.

### 3.4 Pinball score & combo

- **Score**: a large tabular-numeral figure, top-right, grouped pinball style (e.g.
  `1,234,560`). On `scoreChanged` the field **pops**. The event's `reason` drives a
  short floating call-out near the score (`JACKPOT!`, `SKILL SHOT!`, `FRENZY ×5!`,
  `TIDY!`) in the accent colour.
- **Combo / multiplier**: an `×N` badge directly under the score reflecting
  `scoring.multiplier`. On `comboChanged` it pulses; growth scales the badge, and a
  reset to ×1 flashes it down so a lost combo is felt.
- The HUD reads `scoring.score` / `scoring.multiplier` for the resting display and
  uses events **only** to trigger animation transitions, so a missed event can never
  desync the displayed number from state.

### 3.5 Resident interaction panel

**Form — a vertical "building" list.** The skyscraper is intrinsically *vertical*, so
a column of floors is the natural, on-theme metaphor; it scales cleanly to the roster
and to each resident's several options, and it maps directly onto keyboard
(up/down/confirm), pointer, and touch with one model. Each row shows the resident and
their currently-available options, split into **BUY** (services, with a `₽` price and
an affordability flag) and **BEG** (favors, shown when broke, each with a one-line
consequence preview).

**The panel only renders what it is given.** It calls the read-only Economy selector
`getAvailableInteractions(state)`, which has *already* filtered options by rubles,
reputation, and incident flags (toilet hidden during a pipe incident, prices raised
during a supply shortage). The UI performs **no** economy logic — it lists exactly the
entries returned, in order, and greys an entry only when the selector marks it with a
`disabledReason`.

**Opening / closing.** Opened with a single bound key — default **`E`** ("Intercom"),
rebindable via Settings. Pressing it again, `Esc`, or selecting *Close* dismisses it.
**On touch** there is no keyboard, so the HUD also renders an **on-screen intercom
button** that toggles the panel; in-panel navigation and confirm are pointer-driven.
Every interactive hit-area meets the **minimum tap-target size** and sits **inside the
safe-area insets** (`compatibility.md §3/§9`).

**Real-time, not paused (default).** While the panel is open **the action continues**
— drones keep coming and meters keep draining. This is deliberate and central to the
GDD's core tension: stepping away from the gun to manage your body is a real
risk/reward decision, not a free timeout. An accessibility setting **Pause while panel
open** lets players who need it freeze the sim; when set, the UI raises a pause
request that the `Playing` scene honours (the UI still never mutates the sim).

**Selection → intent.** Confirming an option **emits a player intent** that the
Economy area consumes; the UI changes no rubles, meters, or reputation:

```ts
type ResidentIntent =
  | { kind: 'buyService'; residentId: string; serviceId: string }
  | { kind: 'begFavor';   residentId: string; favorId: string }
  | { kind: 'closePanel' };
```

**Transaction feedback.** Once the engine has applied the intent, the scene fills a
feedback record (what it cost, what it relieved, what it cost you socially) and the UI
pops it as a short dialog with staggered rows. A monotonically increasing nonce lets
the UI replay the entrance animation when the same result occurs twice in a row.

### 3.6 Banners & crisis states

- **Wave / air-raid siren banner**: top-centre, showing that a wave is inbound and
  the countdown until it arrives; clears once the drones are in the air.
- **Incident telegraph banner**: slides in from top-centre on `incidentStart` with the
  incident's cheerful announcement copy. While active it shrinks to a persistent
  badge; on `incidentEnd` it leaves with a "survived!" flourish (the bonus itself is
  awarded by Scoring).
- **Crisis states**: on `meterCrisis{entered:true}` the screen edges pulse in the
  danger colour and the offending meter is emphasised; cleared on `entered:false`.
  With **`reducedFlash`** set, pulsing is replaced by a steady high-contrast
  treatment — same information, no strobing.

### 3.7 Interior mode

When the player walks down into the building, the camera drops inside (area 11) and
the UI switches emphasis: the resident panel takes focus, the aiming affordances
recede, and the current floor and occupant are named. The HUD stays legible — meters
keep draining and must keep being readable, because that is the whole tension of
leaving the roof.

### 3.8 Input & accessibility

- **One navigation model for all inputs.** Keyboard (up/down/confirm/cancel), pointer,
  and touch all drive the same pure model. There is no separate touch code path.
- **Focus is always visible** and never lost: mounting a screen focuses its first
  actionable element; overlays trap focus and restore it on close.
- **The scene owns activation, the DOM only reports it.** A list screen focuses the
  *container* and marks its selection with `aria-activedescendant`; it never focuses an
  option element. A focused `<button>` self-activates on Enter/Space, which would confirm
  a second time on the very keypress the scene is already routing — so options also
  cancel the default action of those keys.
- **Decorative motion never moves a hit target.** The selection bob animates a caret
  pseudo-element, not the button box, so the tap target holds still under a finger (and
  under an automated click, which waits for the element to stop moving).
- **`reducedMotion`** neutralises the motion tokens — transitions become instant,
  decorative animation stops — without changing layout or hiding information.
- **`reducedFlash`** removes strobing everywhere and caps the render quality tier.
- **`largeHudText`** scales the type scale up without breaking layout (the fluid
  scale and Grid layout absorb it).
- **Aim is never swallowed.** Non-interactive UI is click-through; this is tested.
- Respect `prefers-reduced-motion` as the default for `reducedMotion` when the player
  has expressed no preference.

## 4. Public interface (TypeScript)

The UI is composed of a **shell** (owns screens and focus), **screens**, the **HUD
overlay**, and a **pure navigation model**. Illustrative signatures; final types live
in `src/ui/`.

```ts
import type { GameState } from '../state/game-state';
import type { PlayingViewState } from '../state/playing-view';
import type { SystemContext } from '../state/system-context';
import type { InputEvent } from '../core/input';
import type { CameraState } from '../render/three/camera-director';

export interface SettingsView {
  reducedFlash: boolean; // mirrors Settings.accessibility.reducedFlash (09 §5)
  reducedMotion: boolean;
  largeHudText: boolean;
  pauseWhilePanelOpen: boolean;
  residentPanelKey: string; // default 'KeyE'
}

/** One mounted piece of UI. Owns DOM, owns no game logic. */
export interface UiScreen<VM = unknown> {
  mount(root: HTMLElement): void;
  update(vm: VM): void;
  unmount(): void;
}

/** Owns the #ui root: which screen is mounted, transitions, focus. */
export interface UiShell {
  show(id: string, screen: UiScreen): void;
  hide(id: string): void;
  /** Requests a camera state from the three.js view; never positions a camera. */
  setBackdropMode(state: CameraState): void;
  dispose(): void;
}

export function createUiShell(root: HTMLElement): UiShell;
```

Pure list navigation (`src/ui/shell/menu-model.ts`) — no DOM, fully unit-tested:

```ts
export interface MenuModel {
  readonly count: number;
  readonly index: number;
  readonly isEnabled: (i: number) => boolean;
}

/** Wraps around and skips disabled entries. Returns the new index. */
export function moveSelection(m: MenuModel, delta: number): number;
/** Clamps an out-of-range or now-disabled index back into a valid one. */
export function clampSelection(m: MenuModel): number;
```

The in-game HUD:

```ts
export interface Hud extends UiScreen<{ state: GameState; view: PlayingViewState }> {
  /** True if the event was consumed by the UI; false → passes through to the gun. */
  onInput(e: InputEvent): boolean;
  isPanelOpen(): boolean;
  /** True only when the panel is open AND pauseWhilePanelOpen is set. */
  wantsPause(): boolean;
}

export function createHud(
  ctx: SystemContext,
  settings: SettingsView,
  economy: { getAvailableInteractions(state: GameState): ResidentMenuModel },
): Hud;
```

There is **no `render(r: Renderer, …)`**. The UI is DOM: it updates on state change,
not once per rendered frame.

View-model the UI consumes from Economy (read-only; Economy computes it):

```ts
export interface ResidentMenuModel { residents: ResidentMenuEntry[]; }

export interface ResidentMenuEntry {
  residentId: string;
  name: string;
  floor: number;
  reputation: number;
  services: MenuOption[]; // BUY — already filtered to currently available
  favors: MenuOption[];   // BEG — present (typically) only when broke
}

export interface MenuOption {
  id: string;
  label: string;
  costRubles?: number;         // services only
  affordable?: boolean;        // services only
  consequencePreview?: string; // favors only
  disabledReason?: string;     // if set, render greyed; selection blocked
}
```

`createHud` subscribes to the event bus (`rublesChanged`, `scoreChanged`,
`comboChanged`, `meterCrisis`, `incidentStart`, `incidentEnd`, `droneEscaped`,
`serviceBought`, `favorBegged`) to drive animations, and emits `ResidentIntent` via
`ctx.events` for Economy to consume.

## 5. Data / content tables

The UI owns only presentation constants (no gameplay data):

- **Meter indicator map** — fixed glyphs: `sleep→😴, hunger→🍞, thirst→💧, vice→🚬,
  poo→💩`, rendered as **system emoji** through the shared `.icon` class and the font
  stack documented in `compatibility.md §2`. No sprite atlas, no canvas text.
- **Design tokens** — `src/ui/styles/tokens.css` is the single source of colour,
  type scale, spacing, radii, elevation, durations, and easing. Colours are mirrored
  by `src/render/three/theme.ts` so the interface and the world agree; neither file
  redefines the other's values ad hoc.

All meter thresholds and colour-by-state come from the Meters slice; all economy
option data comes from the Economy selector.

## 6. Persistence

**None owned.** The UI *reads* a `SettingsView` (accessibility toggles, UI text size,
resident-panel key) sourced from the Settings repo owned by State & Persistence. It
writes nothing to localStorage.

## 7. Dependencies & integration

- **Reads** `GameState` slices: `meters`, `player` (rubles, debt), `scoring` (score,
  multiplier), `combat` (city integrity, wave), `incidents` (active + announcement
  copy) — plus `PlayingViewState` for mode, floor, occupants, options, and feedback.
- **Subscribes** (for animation triggers): `rublesChanged`, `scoreChanged`,
  `comboChanged`, `meterCrisis`, `incidentStart`, `incidentEnd`, `droneEscaped`,
  `serviceBought`, `favorBegged`.
- **Emits**: `ResidentIntent` (`buyService` / `begFavor` / `closePanel`) — consumed
  and validated by the **Economy & Residents** area.
- **Consumes (read-only)**: Economy's `getAvailableInteractions(state)` selector;
  input events and the event bus; the `SettingsView`; `ThreeView.setCameraState` for
  backdrop choreography.
- **Must not** mutate any gameplay slice, and **must not** position cameras or touch
  three.js objects. The only outward effects are emitted intents, the optional
  `wantsPause()` signal, and camera-state *requests*.

## 8. Required automated tests (MUST pass)

Unit tests for `menu-model.ts` run in the default **node** environment (no DOM).
Screen and HUD tests opt into **jsdom** per file, with a fake event bus and a stub
Economy selector — no real WebGL, canvas, or audio. Every test below must pass and
`npm run check` must be green per architecture.md §7.

1. **Menu model — movement and wrap** *(pure)* — moving past the last entry wraps to
   the first and vice-versa.
2. **Menu model — skips disabled** *(pure)* — movement never lands on a disabled
   entry; an all-disabled list does not loop forever.
3. **Menu model — clamping** *(pure)* — an out-of-range or newly-disabled index is
   clamped back to a valid, enabled one.
4. **Meter values → bar widths** — given meter values, each bar's fill is proportional
   (0%, mid, 100%).
5. **Meter colour states** — below `warn` renders the good state, between `warn` and
   `crisis` the warn state, at crisis the danger state; asserted via the rendered
   state attribute/class, and driven purely by the inputs.
6. **Meter icons** — the indicator map is exactly `sleep→😴, hunger→🍞, thirst→💧,
   vice→🚬, poo→💩`, and each is emitted through the shared `.icon` class.
7. **Rubles and debt** — display equals `player.rubles`; `rublesChanged{+1}` updates
   the shown value and triggers the pop; the debt line is hidden at `debt === 0` and
   shown as `DEBT ₽-<n>` above it.
8. **Score and combo** — display equals `scoring.score` and `×N` equals
   `scoring.multiplier`; `scoreChanged` renders the correct `reason` call-out; a reset
   to ×1 triggers the down-flash.
9. **Crisis presentation respects `reducedFlash`** — `meterCrisis{entered:true}`
   marks the named meter; with `reducedFlash` set the treatment is steady rather than
   strobing; `entered:false` clears it.
10. **Incident banner** — hidden initially; shows the announcement text between
    `incidentStart` and `incidentEnd`; hidden afterwards.
11. **Resident panel lists exactly the available options** — given a
    `ResidentMenuModel`, the panel lists exactly those services/favors (no more, no
    fewer) with correct labels, prices, and affordability; a `disabledReason` entry
    renders disabled and is non-selectable.
12. **Selection emits the correct intent** — confirming a service emits
    `{kind:'buyService', residentId, serviceId}`; a favor emits
    `{kind:'begFavor', residentId, favorId}`; closing emits `{kind:'closePanel'}`.
    Assert the exact payloads.
13. **Input routing & open/close** — the bound key opens the panel; while open,
    `onInput` returns `true` and up/down/confirm move selection; while closed it
    returns `false` so input reaches the gun. A tap on the intercom button toggles the
    panel.
14. **The UI does not swallow aim input** — a `pointerdown` on a non-interactive part
    of `#ui` is not consumed: the UI root is `pointer-events: none` and only
    interactive descendants opt in.
15. **Live vs. pause** — with default settings, opening the panel leaves
    `wantsPause() === false`; with `pauseWhilePanelOpen` set it returns `true`.
16. **Transaction feedback** — a new feedback record with an incremented nonce is
    rendered, and repeating the same result re-triggers the entrance.
17. **Screen lifecycle & focus** — mounting a screen focuses its first actionable
    element; unmounting removes its nodes and its listeners (no leaks across mounts).

**No screenshot snapshot of the meter icon row.** Emoji artwork differs per engine
and OS version by design (`compatibility.md §2/§8`); icons are asserted structurally,
and any screenshot that includes them must mask them.

## 9. Acceptance criteria / Definition of done

On top of the global DoD (architecture.md §9):

- [ ] Every UI region in §3 lays out correctly from small phone to desktop, inside
      safe-area insets, with interactive elements at or above the minimum tap size.
- [ ] The five meter icons render as system emoji through the documented font stack;
      the poo meter clearly reads as 💩.
- [ ] The touch intercom button opens and closes the resident panel.
- [ ] Meter colours/thresholds, score/combo, rubles/debt, and city integrity are all
      driven by `GameState` (never recomputed in the UI), with events used only for
      animation transitions.
- [ ] The resident panel lists exactly what the Economy selector returns and emits
      only `ResidentIntent`s — it applies no economy rule and mutates no state.
- [ ] No colour, size, or duration literal lives in a `.ts` file; all of them are
      design tokens.
- [ ] `#ui` is click-through except on interactive elements — aiming is never blocked.
- [ ] `reducedMotion`, `reducedFlash`, and `largeHudText` are all honoured, and screen
      transitions are choreographed with the camera states.
- [ ] All tests in §8 pass; `tsc --noEmit`, ESLint, `vitest run`, and the Playwright
      matrix are green (`testing.md`).

## 10. Open questions / risks

- **Emoji icons — DECIDED:** the five meter indicators are **system emoji** in the DOM
  layer, using the font stack in `compatibility.md §2`. The old ban existed because
  colour emoji blurred at 384×216 on canvas; DOM at native resolution removes that
  problem. Per-platform artwork variance is **accepted**, and is the reason no
  screenshot snapshot may assert on them.
- **UI over a busy 3D scene**: text must stay readable against a bright sky or an
  explosion. Mitigate with scrims and elevation tokens, not with heavier text; if a
  region proves unreadable, darken the backdrop behind it rather than shouting.
- **Real-time panel fairness**: if the live panel proves too punishing in playtests,
  consider a brief slow-mo rather than a full pause — coordinate with Gameplay
  Engine/Meters before changing the default.
- **Intent transport**: confirm with Economy whether `ResidentIntent` travels over the
  event bus or a per-frame intent queue; this doc assumes the event bus and must match
  Economy's consumption side.
- **Selector cost**: `getAvailableInteractions` is called when the panel opens and on
  relevant state changes, not every frame.
- **DOM churn**: the HUD must update only what changed. Rebuilding subtrees every
  frame will cost more than the 3D scene does.
