# Technical Architecture & Engineering Contract

> Status: **Foundation doc (authored by lead).** This defines the tech stack,
> project structure, the shared contracts that let independent areas integrate, the
> testing strategy every area must satisfy, and the template every area task
> follows. Read `docs/game-design.md` and `docs/compliance.md` first, then
> `docs/testing.md` (quality gates) and `docs/compatibility.md` (browser/mobile).

## 1. Tech stack

- **Language:** TypeScript, `strict: true`. No implicit `any`.
- **Build/dev:** [Vite](https://vitejs.dev/) (ES modules, fast HMR, static build).
- **Rendering:** **three.js over WebGL2**, rendered at the device's native resolution
  (capped device-pixel-ratio). The 3D world is the only drawing surface; there is no
  Canvas-2D renderer, no sprite atlas, and no fixed pixel-art backing buffer.
  See §6 for the render/UI layering contract and `compatibility.md §2` for the WebGL
  requirement + degraded no-WebGL mode.
- **User interface:** **DOM + CSS**, composited over the live 3D scene. Menus, the HUD,
  overlays, and dialogs are real DOM elements driven by a design-token stylesheet — crisp
  at native resolution, accessible, and directly assertable in Playwright.
- **Audio:** Web Audio API (see Audio area).
- **Tests:** [Vitest](https://vitest.dev/) (+ `jsdom` environment for DOM-touching tests)
  for unit/integration/DOM; **mandatory** [Playwright](https://playwright.dev/)
  cross-browser matrix (Chromium + WebKit + Firefox + emulated iPhone) as a CI gate —
  see `testing.md` and `compatibility.md §8`.
- **Lint/format:** ESLint + Prettier. **Typecheck:** `tsc --noEmit`.
- **Persistence:** `localStorage` via a wrapped, injectable storage module.

**Dependency policy:** `three` is the only runtime dependency. Its bundled addons
(`three/examples/jsm/**` — `EffectComposer`, `RenderPass`, `UnrealBloomPass`, `SMAAPass`,
`OutputPass`) are in scope; adding any *new* runtime package requires lead sign-off.
No game framework, no UI framework — logic stays testable and dependency-light.

**Simulation vs. presentation resolution.** `384×216` survives as the **arena coordinate
space the simulation runs in** (spawn positions, aim angles, collision math, balance
tables). It is *not* a render resolution and never was a virtue in itself — it is simply
the unit system `src/content/balance.ts` is authored in. The renderer maps arena space
into 3D world units and back (`src/render/three/mapping.ts`); gameplay is unaware a
camera exists.

**Target browsers:** evergreen desktop + iOS/iPadOS Safari 15.4+ (mobile is a
first-class target). Full matrix and Safari specifics in `compatibility.md`.

No backend. Everything runs client-side and ships as static files.

## 2. Project structure

```
/
  index.html           # #game3d (WebGL canvas) + #ui (DOM UI root) + #rotate-overlay
  package.json
  tsconfig.json
  vite.config.ts
  vitest.config.ts
  eslint.config.js
  /src
    main.ts            # bootstrap: canvas, UI shell, input, audio unlock, game loop driver
    /core              # loop, fixed timestep, seedable RNG, clock, event bus, math, ECS registry
    /state             # app state machine (scenes) + shared GameState type
    /systems           # pure-ish update systems: spawning, shooting, meters, economy, scoring, incidents, difficulty
    /render
      /three           # the three.js presentation layer (see §6.2)
    /audio             # audio engine, music director, sfx bank
    /ui
      /styles          # design tokens + stylesheets (tokens.css, shell.css, hud.css)
      /shell           # UI runtime: screen registry, transitions, pure menu-navigation model
      /screens         # one DOM screen per scene: main menu, settings, game over, highscores, credits, pause
    /persistence       # storage wrapper, highscores repo, settings repo, migrations
    /content           # DATA: drone types, resident roster, incident catalog, balance tables
    /types             # cross-cutting shared types
  /tests               # integration + Playwright e2e (unit tests co-locate as *.test.ts)
  /docs                # planning docs (this folder)
```

Co-locate unit tests as `foo.test.ts` next to `foo.ts`. Cross-area integration
tests live in `/tests`.

## 3. Architectural principles (these make the game testable)

1. **Pure logic, side effects at the edges.** All gameplay rules are pure functions
   over state: `update(slice, dt, ctx) -> newSlice` (or mutate-in-place on a plain
   data `GameState` — pick one convention per area and document it). Rendering,
   audio, DOM, and storage are side-effecting modules invoked *outside* the logic.
   Logic modules must not import rendering/audio/DOM.
2. **Deterministic & seedable.** No `Math.random()` in logic. Use the injected
   seedable PRNG from `core/rng`. Same seed + same inputs ⇒ identical run. This is
   what makes gameplay testable.
3. **Time is injected.** No `Date.now()` / `performance.now()` inside logic. Systems
   receive `dt` (seconds). Only `main.ts`'s loop driver reads the real clock. Tests
   advance time by calling `update` with chosen `dt`.
4. **Fixed-timestep update, interpolated render.** Logic updates at a fixed 60 Hz
   accumulator; rendering interpolates. Deterministic regardless of frame rate.
5. **Decoupled via a typed event bus.** Systems emit/observe typed events (§5) so
   audio, scoring, and HUD can react to e.g. `droneDestroyed` without hard coupling.
6. **Data-driven content.** Drone stats, resident tables, incident definitions, and
   balance curves live in `src/content/` as typed data, not buried in logic. Tuning
   must not require touching system code.

## 4. Core shared types (the `GameState`)

`GameState` is a plain object composed of **slices**, one per gameplay area. Each
area owns its slice's shape and its update function. The skeleton (areas refine
their own slice; do not change another area's slice without coordination):

```ts
// src/state/game-state.ts  (skeleton — owned collectively, changes via lead)
export interface GameState {
  time: { shiftSeconds: number; phase: 'day' | 'night'; difficulty: number };
  player: { rubles: number; debt: number; reputation: number };
  meters: MetersState;        // Meters area
  combat: CombatState;        // Gameplay Engine area (drones, projectiles, aim, postIntegrity)
  scoring: ScoringState;      // Scoring area
  economy: EconomyState;      // Economy & Residents area
  incidents: IncidentsState;  // Random Incidents area
  rng: RngState;              // core/rng
  flags: Record<string, boolean>;
}
```

`ctx` passed to systems provides injected capabilities:

```ts
export interface SystemContext {
  rng: Rng;            // core/rng — seedable
  events: EventBus;    // core/events
  content: Content;    // loaded src/content data tables
}
```

## 5. The event bus contract

`core/events` exposes a typed emitter. Event names + payloads are a **shared
contract**; adding an event is fine, changing an existing payload requires lead
sign-off. Baseline events (areas extend this map):

```ts
export interface GameEvents {
  droneSpawned:   { id: number; kind: string };
  droneDestroyed: { id: number; kind: string; byPlayer: boolean; pos: Vec2 };
  droneEscaped:   { id: number; damage: number };          // hit the building
  shotFired:      { from: Vec2; angle: number };
  rublesChanged:  { delta: number; total: number };
  meterCrisis:    { meter: MeterKey; entered: boolean };
  serviceBought:  { residentId: string; service: string; cost: number };
  favorBegged:    { residentId: string; favor: string; consequence: string };
  incidentStart:  { id: string };
  incidentEnd:    { id: string };
  scoreChanged:   { delta: number; total: number; reason: string };
  comboChanged:   { multiplier: number };
  // Extends the original {score, cause} with the run stats the persistence layer needs to build
  // a RunSummary on game over (supplied by the Gameplay Engine). Lead-approved payload extension.
  gameOver:       { score: number; cause: string; shiftSeconds: number; dronesDowned: number };
}
```

## 6. App state machine, rendering & UI layering

### 6.1 Scenes

`state/` owns a finite state machine over scenes:

```
Boot → MainMenu → Playing ⇄ Paused
                    Playing → GameOver → (HighscoreEntry?) → Highscores → MainMenu
MainMenu → Settings → MainMenu
MainMenu → Highscores → MainMenu
MainMenu → Credits → MainMenu        (and optionally GameOver/Highscores → Credits)
```

Each scene implements `{ enter(params, ctx), update(dt, ctx), render(alpha), onInput(e), exit() }`.

**A scene does not draw.** `render(alpha)` is a *presentation sync* step: the scene projects
its state into a view model and hands it to its DOM screen and/or the 3D view. `alpha` is the
fixed-timestep interpolation factor (0..1) for tweening. This replaces the retired
`render(r: Renderer)` Canvas-2D contract.

The Gameplay Engine owns the `Playing` scene; UI areas own menu/highscore/settings scenes. The
lead owns the `Scene` / `SceneManager` / `ThreeView` / `UiScreen` contracts; **State &
Persistence (09) implements the `SceneManager` FSM** (transition graph, overlays, lifecycle).

### 6.2 The three.js layer (`src/render/three/`)

The 3D world is a **pure renderer**: it reads `GameState` plus a scene-supplied view model
each frame and never mutates gameplay. It is live at all times — during menus it renders a
cinematic backdrop, not a frozen image.

| Module | Responsibility |
| --- | --- |
| `mapping.ts` | **Pure.** Arena (384×216) ↔ world-unit conversion + its inverse. No `three` import. |
| `camera-director.ts` | **The single camera state machine.** Owns every pose — `menu`, `intro`, `shooting`, `interior`, `pause` — and all blends between them. Pose/blend math is pure (`{eye, look, fov}` records). |
| `world.ts` | Scene-graph construction: skyline towers, the soldier's cut-away tower, roof deck, drone/projectile pools. |
| `soldier.ts` | The soldier figure standing on the roof deck (§ Art area), posed from meter state. |
| `lighting.ts` | Day/night rig, tone mapping, shadow policy, quality tiers. |
| `post.ts` | Post-processing chain (bloom, SMAA, vignette, colour grade). |
| `theme.ts` | Named scene colours, mirroring the CSS design tokens. |
| `view.ts` | Thin façade exposing the `ThreeView` contract + the no-WebGL `noopView` fallback. Holds **no** pose logic. |

**Aiming.** Pointer→arena mapping ray-casts against the fixed `z = 0` action plane through a
dedicated camera pinned to the director's canonical `shooting` pose. That camera must be
derived from the director (single source of truth) and never moved, so `screenToWorld` stays
exact while the render camera cranes and blends.

**No-WebGL.** `createThreeView` probes for a WebGL2 context silently and returns a no-op view
if unavailable. The simulation and the entire DOM UI keep working over a CSS gradient backdrop.

### 6.3 The DOM UI layer (`src/ui/`)

All player-facing chrome is DOM. `src/ui/shell/` is the runtime (screen registry, mount/unmount,
enter/exit transitions, focus management, and a **pure** list-navigation model);
`src/ui/screens/` holds one screen per scene; `src/ui/styles/` holds the design tokens every
screen consumes. `src/ui/game-overlay.ts` is the in-game HUD.

Rules:

- UI **reads** `GameState` / view models and **emits intents**. It never mutates game state.
- All colour, type, spacing, and easing come from CSS custom properties in
  `src/ui/styles/tokens.css` — no hard-coded values in TypeScript.
- `#ui` is `pointer-events: none` by default; interactive panels opt in. Aim input must never
  be swallowed by an invisible UI layer.
- Every screen is keyboard-navigable and pointer/touch-operable; see `areas/10-hud-ui.md`.

### 6.4 Dependency direction

```
content ─▶ systems ─▶ state ─▶ { render/three , ui }
                                       └── never imported by systems/state logic
```

Renderers may import `state` **types**; `systems/` and `state/` logic must not import
`render/` or `ui/` implementation. The seam is the per-scene view model
(e.g. `state/playing-view.ts`), which is types-only so both renderers can consume it
without a cycle.

## 7. Testing strategy (mandatory for every area)

**The full testing contract now lives in [`testing.md`](testing.md)** — it supersedes
this section. In short: this game is **built by AI**, so the gates are designed to be
**un-gameable and CI-enforced**, not assertable. Highlights:

- Unit + integration + DOM tests in **Vitest** (deterministic via seeded RNG and
  injected `dt`; no wall-clock/real-timer/`Math.random()`/real audio).
- **`npm run check`** = `tsc --noEmit && eslint . && vitest run`, **plus** the
  mandatory **Playwright cross-browser matrix** (`compatibility.md §8`), the
  content-compliance lint, and (for logic areas) **mutation testing** (StrykerJS).
- Coverage on logic modules: **≥ 85% lines, branches, and functions** (not lines
  alone); thresholds are committed and lowering them needs lead sign-off.
- A **determinism golden test** guards "same seed ⇒ identical run."
- **CI is the source of truth** — an area is done only when CI is green and an
  **independent reviewer** (not the authoring agent) has signed off.

Each area task lists its **required tests** explicitly in its §8. Treat that list as a
minimum, and see `testing.md` for the anti-pattern rules every test must satisfy.

## 8. Integration & ownership rules

- An area may freely change files inside its own directory/slice.
- Shared skeletons (`state/game-state.ts`, `state/scene.ts`, `core/events.ts`,
  `state/scene-manager`, `core/rng`, the `persistence` interface, and the
  `ThreeView` / `UiScreen` presentation contracts) are **lead-owned**; propose changes
  via PR tagged for lead review.
- Communicate cross-area needs through events and the `GameState` slice contract —
  never reach into another area's internal modules.
- Content tables in `src/content/` are shared data; each area owns the tables for
  its domain (e.g. Economy owns residents, Incidents owns the incident catalog).

## 9. Definition of done (applies to every area)

An area is complete when:

1. Its functionality matches the requirements in its task doc and the GDD.
2. Public interfaces match the contracts in this doc (or changes were approved).
3. Required automated tests are authored **and pass in CI** — `npm run check`, the
   Playwright cross-browser matrix, and (for logic areas) the mutation run are all
   green per `testing.md`. CI is the source of truth, not an agent's claim.
4. No `console` spam, no `any` without a written justification, no dead code, and no
   gate-gaming shortcuts (`.only`/`.skip`, bare `@ts-ignore`/`as any`, lowered
   thresholds, assertion-free or mock-only tests) — see `testing.md §4`.
5. A short README section (or doc update) documents the area's public API and data
   tables.
6. All player-facing copy, names, art, and audio comply with `docs/compliance.md`
   (respect & anti-stereotype policy), verified by the content-lint + an independent
   reviewer (`testing.md §8`).
7. If the area renders, takes input, plays audio, or persists, it satisfies its row
   in `docs/compatibility.md §9` and the matching cross-browser tests pass on WebKit.
8. An **independent reviewer** (not the agent that wrote the code) has signed off
   (`testing.md §9`).

---

## 10. Area task document template

Every file in `docs/areas/` MUST follow this structure so engineers can pick one up
cold:

```md
# Area: <name>

**Owner:** <unassigned> · **Depends on:** <areas> · **Depended on by:** <areas>

## 1. Purpose
One paragraph: what this area is responsible for.

## 2. Scope
### In scope
- ...
### Out of scope (owned elsewhere)
- ...

## 3. Requirements & mechanics
Detailed, numbered functional requirements derived from the GDD.

## 4. Public interface (TypeScript)
The types, functions, slice shape, and events this area exposes/consumes.

## 5. Data / content tables
Any `src/content/` data this area defines, with shapes and example rows.

## 6. Persistence
Anything written to localStorage (schema + keys), or "none."

## 7. Dependencies & integration
Events consumed/emitted; other slices read/written; injected ctx used.

## 8. Required automated tests  (MUST pass)
Enumerated test cases (unit + integration + DOM as applicable). This is a minimum.

## 9. Acceptance criteria / Definition of done
Checklist specific to this area, on top of the global DoD (§9 above) — including the
compliance check (player-facing copy/names/art/audio reviewed against
`docs/compliance.md`).

## 10. Open questions / risks
```

## 11. Areas (index)

See `docs/README.md` for the full index and suggested build order. The areas:

1. Core Platform & Build  — `areas/00-core-platform.md`
2. Gameplay Engine        — `areas/01-gameplay-engine.md`
3. Gameplay Status (Meters) — `areas/02-meters-and-status.md`
4. Economy & Residents    — `areas/03-economy-and-residents.md`
5. Scoring (Pinball)      — `areas/04-scoring.md`
6. Random Incidents       — `areas/05-random-incidents.md`
7. Audio (Music & SFX)    — `areas/06-audio.md`
8. Main Menu              — `areas/07-main-menu.md`
9. Highscores             — `areas/08-highscores.md`
10. State & Persistence   — `areas/09-state-and-persistence.md`
11. HUD & In-game UI      — `areas/10-hud-ui.md`
12. Art & Visual Style    — `areas/11-art-visual-style.md`
13. Credits View          — `areas/12-credits.md`
