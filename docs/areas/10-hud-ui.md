# Area: HUD & In-game UI

**Owner:** <unassigned> · **Depends on:** Core Platform (renderer, input, event bus), Gameplay Status / Meters (values, thresholds, crisis state), Economy & Residents (available-interactions selector + intent contract), Scoring (score, multiplier), Gameplay Engine (post integrity, player rubles/debt), Random Incidents (active incidents + announcement copy), Art & Visual Style (palette, bitmap font, atlas, emoji-on-canvas rendering), State & Persistence (Settings view: accessibility + HUD scale) · **Depended on by:** Gameplay Engine (the `Playing` scene composes and drives this overlay)

## 1. Purpose

This area owns everything the player reads and touches *on top of* the live action
during a shift: the heads-up display (the five need meters, the ruble counter, the
pinball score, the combo multiplier, post integrity, debt) and the **resident
interaction panel** through which the player buys services or begs favors. The HUD
is a pure presentation + intent layer: it **reads** `GameState` and **emits player
intents**, but never mutates gameplay state itself. It is drawn over the `Playing`
scene at the fixed 384×216 internal resolution and integer-scaled by the core
scaler like everything else.

## 2. Scope

### In scope
- The persistent in-game HUD overlay and all of its widgets (meters, rubles, score,
  combo, post integrity, debt).
- Event-driven HUD animations: ruble cash-change pop, score roll/pop, combo pulse,
  crisis flashers, confirmation toasts.
- The incident telegraph banner (cheerful ribbon) driven by `incidentStart` /
  `incidentEnd`.
- The resident interaction panel: opening it, navigating residents and their
  currently-available services/favors, and emitting the selected **player intent**.
- Routing player input while the panel is open vs. passing it through to the gun.
- Honoring accessibility settings (reduced flashing, larger HUD text).

### Out of scope (owned elsewhere)
- Computing meter values, thresholds, or crisis rules → **Meters** area.
- Computing which services/favors are available, their prices, reputation/incident
  gating, and resolving outcomes → **Economy & Residents** area. The HUD renders the
  list it is *given* and emits an intent; it does not apply any economy rule.
- Score/combo math → **Scoring**. Drone/post simulation and the `Playing` scene
  lifecycle → **Gameplay Engine**.
- Menus outside a run (title, settings, highscores) → **Main Menu** / **Highscores**.
- Palette, fonts, sprites, emoji glyph rendering → **Art & Visual Style**.
- The localStorage schema for settings → **State & Persistence**.

## 3. Requirements & mechanics

### 3.1 HUD layout (384×216)

The HUD frames the screen edges and keeps the central sky clear for aiming. ASCII
sketch (full 384×216 frame; annotations are pixel regions, not literal glyphs):

```
(0,0)                          384 px wide                          (383,0)
┌──────────────────────────────────────────────────────────────────────┐
│ 😴 ▓▓▓▓▓░░░░░          ╔══ INCIDENT BANNER (slides in) ══╗   01,234,560 │  ← score (top-right,
│ 🍞 ▓▓░░░░░░░░          ║  "💧 PIPE PARTY! Toilets closed!" ║      ×7    │     big bitmap font;
│ 💧 ▓▓▓▓▓▓▓░░░          ╚══════════════════════════════════╝   combo ×N │     combo under it)
│ 🚬 ▓▓▓░░░░░░░                                                           │
│ 💩 ▓▓▓▓▓▓▓▓▓▓ ◀ flashing (crisis)                                       │  ← 5 meter bars,
│                                                                        │     top-left column
│                                                                        │
│                          (clear sky / play area —                      │
│                           drones, aim reticle, gun)                    │
│                                                                        │
│                                                                        │
│                                                                        │
│ ₽ 42      +1↑ (pop)                              POST ▓▓▓▓▓▓▓░░  73%    │  ← rubles bottom-left,
│ DEBT ₽-13 (red, only if debt>0)                  (depletes ←, shield)   │     post integrity
└──────────────────────────────────────────────────────────────────────┘     bottom-right
```

When the resident panel is open it occupies the right ~40% as a vertical "building"
side panel (see §3.5); the meters and sky stay visible behind/around it.

### 3.2 The five meter widgets

- One compact widget per meter, stacked top-left in fixed order: **😴 Sleep, 🍞
  Hunger, 💧 Thirst, 🚬 Vice, 💩 Poo**. The **poo meter MUST use the literal poo
  emoji `💩`** as its indicator (hard requirement from the brief).
- Each widget = `[emoji glyph][horizontal bar]`. The bar **fills toward danger**
  (0 = empty/safe, 100 = full/crisis), matching the meters convention (0 safe → 100
  crisis). Fill width is proportional to the meter value.
- **Color state is read from the Meters slice**, not recomputed here: fill is
  **green** while `value < warn`, **amber** while `warn ≤ value < crisis`, and
  **red** at crisis. The HUD reads `meter.value`, `meter.warn`, and the crisis flag;
  it does not decide thresholds.
- The active-debuff context (e.g. drunk, micro-sleep) is surfaced as a tiny icon/
  tint on the relevant meter when the Meters slice reports it, so the player can
  read *why* aiming feels off.

### 3.3 Rubles, debt, post integrity

- **Ruble counter** (`₽ <n>`) bottom-left with a coin sprite. On `rublesChanged`
  with a positive delta it plays a **cash-change animation**: a floating `+<delta>`
  that rises and fades plus a quick scale-bounce of the counter; the audio area
  plays the cash register off the same event. Negative deltas (spending/debt
  repayment) flash the counter and float a `-<delta>`.
- **Debt indicator**: hidden when `player.debt === 0`; when `debt > 0` it shows
  `DEBT ₽-<n>` in red beneath the ruble counter and pulses while a kill is repaying
  it.
- **Post Integrity**: bottom-right shield bar reflecting `combat.postIntegrity`
  (100→0). Unlike the need meters it **depletes** (full = healthy); color shifts
  green→amber→red as it falls, and it shakes briefly on `droneEscaped`.

### 3.4 Pinball score & combo

- **Score**: large bitmap-font number, top-right, zero-padded pinball style (e.g.
  `01,234,560`). On `scoreChanged` the digits **roll** (odometer style) up to the
  new value and the field **pops** (brief scale-up). The event's `reason` drives a
  short floating call-out near the score (`JACKPOT!`, `SKILL SHOT!`, `FRENZY ×5!`,
  `TIDY!`) styled in score-gold.
- **Combo / multiplier**: an `×N` badge directly under the score reflecting
  `scoring.multiplier`. On `comboChanged` it pulses; growth scales the badge size,
  and a reset (drop to ×1) flashes it down so a lost combo is felt.
- The HUD reads `scoring.score` / `scoring.multiplier` for the resting display and
  uses the events only to trigger animation transitions, so a missed event can never
  desync the number from state.

### 3.5 Resident interaction panel

**Form — a two-pane vertical "building" list (chosen over a radial menu).**
Justification: the skyscraper is intrinsically *vertical*, so a scrollable column of
floors/residents is the natural, on-theme metaphor; it scales cleanly to the
6–8-resident roster and to each resident's several services/favors (a radial gets
crowded past ~6 wedges at 384×216 and reads poorly at retro resolution); and a list
maps directly to both keyboard (up/down/confirm) and pointer input. Left pane = the
building's floors (one row per resident, showing name, floor, reputation pip). Right
pane = the **selected resident's currently-available options**, split into **BUY**
(services, with `₽` price and an affordable flag) and **BEG** (favors, shown when
broke, each with a one-line consequence preview).

**The panel only renders what it is given.** It calls a read-only selector provided
by the Economy area, `getAvailableInteractions(state)`, which has *already* filtered
options by rubles, reputation, and incident flags (e.g. toilet hidden during a pipe
incident, prices raised during a supply shortage). The HUD performs **no** economy
logic — it lists exactly the entries returned, in order, with their labels/prices/
flags, and greys an entry only if the selector marks it with a `disabledReason`.

**Opening / closing.** Opened with a single bound key — default **`E`** ("Intercom"),
rebindable via Settings. Pressing it again, `Esc`, or selecting *Close* dismisses it.

**Real-time, not paused (default).** While the panel is open **the action
continues** — drones keep coming and meters keep draining. This is deliberate and
central to the GDD's core tension ("drones may come at any time"): stepping away from
the gun to manage your body is a real risk/reward decision, not a free timeout. The
panel is a side panel that leaves most of the sky visible so the player can bail out
fast. An accessibility setting **Pause while panel open** (read from Settings) lets
players who need it freeze the sim; when set, the HUD raises a `pauseRequested` flag
the `Playing` scene honors (the HUD still does not mutate the sim directly).

**Selection → intent.** Confirming an option **emits a player intent** that the
Economy area consumes; the HUD itself changes no rubles/meters/reputation. Intent
shape (shared contract with Economy, which validates it):

```ts
type ResidentIntent =
  | { kind: 'buyService'; residentId: string; serviceId: string }
  | { kind: 'begFavor';   residentId: string; favorId: string }
  | { kind: 'closePanel' };
```

On `serviceBought` / `favorBegged` (emitted by Economy after it resolves the intent)
the HUD shows a brief cheerful **confirmation toast** (e.g. "Nikolai brings borscht!
🍞") and, for a favor, surfaces the consequence text.

### 3.6 Incident banner & crisis flashers

- **Incident telegraph banner**: a bright, bouncy ribbon that slides in from
  top-center on `incidentStart`, showing the incident's cheerful announcement copy
  (provided by the Incidents content). While the incident is active it shrinks to a
  small persistent badge; on `incidentEnd` it slides out with a "survived!" flourish
  (the survival score bonus itself is awarded by Scoring).
- **Crisis flashers**: on `meterCrisis{entered:true}` the screen edges pulse red and
  the offending meter widget flashes with an alarm cue; cleared on
  `meterCrisis{entered:false}`. **Reduced-flashing** accessibility setting replaces
  pulsing with a steady high-contrast highlight (no strobing).

## 4. Public interface (TypeScript)

The HUD is an overlay component composed by the `Playing` scene, not a standalone
scene. Illustrative signatures (final types live in `src/ui/hud/`):

```ts
import type { GameState } from '../state/game-state';
import type { Renderer } from '../render';
import type { SystemContext } from '../state/system-context';
import type { InputEvent } from '../core/input';

export interface SettingsView {
  reducedFlashing: boolean;
  largeHudText: boolean;
  pauseWhilePanelOpen: boolean;
  residentPanelKey: string; // default 'KeyE'
}

export interface Hud {
  /** Advance HUD animations; reads (never mutates) state. */
  update(dt: number, state: GameState): void;
  /** Draw the overlay above the world. */
  render(r: Renderer, state: GameState): void;
  /** Returns true if the event was consumed by the panel; false → passes to the gun. */
  onInput(e: InputEvent, state: GameState): boolean;
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

View-model the HUD consumes from Economy (read-only; Economy computes it):

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

The HUD owns only presentation constants (no gameplay data):

- **Meter indicator map** — fixed glyphs: `sleep→😴, hunger→🍞, thirst→💧, vice→🚬,
  poo→💩`. The poo entry is a hard-locked `💩`.
- **HUD theme constants** — widget positions/sizes for 384×216, bar dimensions,
  animation durations (ruble pop, score roll, combo pulse, banner slide), toast
  duration. Colors are **referenced from the Art palette** (warn-amber, crisis-red,
  score-gold, etc.), not redefined here.

All meter thresholds/colors-by-state come from the Meters slice; all economy option
data comes from the Economy selector.

## 6. Persistence

**None owned.** The HUD *reads* a `SettingsView` (accessibility toggles, HUD-text
size, resident-panel key) sourced from the Settings repo owned by State &
Persistence. It writes nothing to localStorage.

## 7. Dependencies & integration

- **Reads** `GameState` slices each frame: `meters`, `player` (rubles, debt),
  `scoring` (score, multiplier), `combat` (postIntegrity), `incidents` (active +
  announcement copy).
- **Subscribes** (for animation triggers): `rublesChanged`, `scoreChanged`,
  `comboChanged`, `meterCrisis`, `incidentStart`, `incidentEnd`, `droneEscaped`,
  `serviceBought`, `favorBegged`.
- **Emits**: `ResidentIntent` (`buyService` / `begFavor` / `closePanel`) — consumed
  and validated by the **Economy & Residents** area.
- **Consumes (read-only)**: Economy's `getAvailableInteractions(state)` selector;
  the core `Renderer`, input events, and event bus; the Art palette, bitmap font,
  sprite atlas, and emoji-on-canvas glyph rendering; the `SettingsView`.
- **Must not** mutate any gameplay slice. The only outward effects are emitted
  intents and the optional `wantsPause()` signal the `Playing` scene chooses to act on.

## 8. Required automated tests (MUST pass)

All run under `jsdom` with a **mock 2D renderer** (capturing draw calls), a fake
event bus, and a stub Economy selector. No real canvas/audio. Every test below must
pass and `npm run check` (tsc + eslint + vitest) must be green per architecture.md §7.

1. **Meter values/widths** — given meter values, each bar's fill width is
   proportional to the value (0%, mid, 100%).
2. **Meter color states** — a meter below `warn` renders green; between `warn` and
   `crisis` renders amber; at crisis renders red. Colors come from the Meters/Art
   inputs, asserted via the captured draw calls.
3. **Poo emoji present** — the poo widget's indicator glyph is exactly `💩` (and the
   other four glyphs are 😴/🍞/💧/🚬).
4. **Ruble display + pop** — display equals `player.rubles`; a `rublesChanged{+1}`
   event triggers the `+1` pop animation and updates the shown value; a negative
   delta flashes and floats `-n`.
5. **Debt indicator** — hidden when `debt === 0`; shown as `DEBT ₽-<n>` when
   `debt > 0`.
6. **Score display + roll** — display equals `scoring.score`; `scoreChanged`
   triggers the roll/pop and the `reason` renders the correct call-out text.
7. **Combo indicator** — `×N` reflects `scoring.multiplier`; `comboChanged` pulses,
   and a reset to ×1 triggers the down-flash.
8. **Post integrity** — bar reflects `combat.postIntegrity` and shakes on
   `droneEscaped`; color shifts as it falls.
9. **Crisis flasher** — `meterCrisis{entered:true}` activates the flasher on the
   named meter; with `reducedFlashing` on it uses a steady highlight (no strobe);
   `entered:false` clears it.
10. **Incident banner** — hidden initially; shows the incident's announcement text
    between `incidentStart` and `incidentEnd`; correct text for a given incident id;
    hidden after `incidentEnd`.
11. **Resident menu lists exactly the available options** — given a
    `ResidentMenuModel` derived from a specific `(rubles, reputation, incident-flags)`
    state, the panel lists exactly those services/favors (no more, no fewer), with
    correct labels, prices, and affordable flags; a `disabledReason` entry renders
    greyed and is non-selectable.
12. **Selection emits the correct intent** — confirming a service emits
    `{kind:'buyService', residentId, serviceId}`; confirming a favor emits
    `{kind:'begFavor', residentId, favorId}`; closing emits `{kind:'closePanel'}`.
    Assert the exact emitted payloads.
13. **Input routing & open/close** — the bound key opens the panel; while open,
    `onInput` returns `true` (consumes nav/confirm) and up/down/confirm move
    selection; while closed, `onInput` returns `false` so input passes to the gun.
14. **Live vs. pause** — with default settings, opening the panel does not request a
    pause (`wantsPause() === false`); with `pauseWhilePanelOpen` set, opening it
    makes `wantsPause()` return `true`.
15. **Confirmation toast** — `serviceBought` / `favorBegged` shows a toast with the
    resident/outcome text for its duration then dismisses.

## 9. Acceptance criteria / Definition of done

On top of the global DoD (architecture.md §9):

- [ ] All HUD widgets in §3 render correctly at 384×216 and integer-scale cleanly.
- [ ] The poo meter uses the literal `💩` emoji.
- [ ] Meter colors/thresholds, score/combo, rubles/debt, and post integrity are all
      driven by `GameState` (never recomputed in the HUD), with events used only for
      animation transitions.
- [ ] The resident panel lists exactly the options the Economy selector returns and
      emits only `ResidentIntent`s — it applies no economy rule and mutates no state.
- [ ] Real-time-by-default behavior works; the pause-on-panel and reduced-flashing
      accessibility settings are honored.
- [ ] Incident banner and crisis flashers respond to the correct events.
- [ ] All tests in §8 pass; `tsc --noEmit`, ESLint, and `vitest run` are green.

## 10. Open questions / risks

- **Emoji on canvas**: rendering 😴🍞💧🚬💩 crisply at 384×216 across browsers needs
  the approach defined by the Art area (native canvas emoji vs. pre-rendered emoji
  sprites baked into the atlas). Pre-baked sprites are likely needed for pixel-
  consistent retro look — confirm with Art and fall back to a sprite if native
  glyphs render inconsistently.
- **Real-time panel fairness**: if the live panel proves too punishing in
  playtests, consider a brief slow-mo (rather than full pause) while open — coordinate
  the lever with Gameplay Engine/Meters before changing the default.
- **Intent transport**: confirm with Economy whether `ResidentIntent` travels over
  the event bus or a dedicated per-frame intent queue; this doc assumes the event bus
  and must match Economy's consumption side.
- **Selector cost**: `getAvailableInteractions` is called when the panel opens (and
  on relevant state changes), not every frame, to avoid per-frame allocation — confirm
  Economy exposes it as a cheap pure selector.
