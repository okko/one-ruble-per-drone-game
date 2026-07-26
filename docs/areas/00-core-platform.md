# Area: Core Platform & Build

**Owner:** <unassigned> · **Depends on:** none · **Depended on by:** all areas

## 1. Purpose

The Core Platform is the foundation every other area plugs into. It owns the build
toolchain, the deterministic game loop, the seedable RNG, the injected clock, the
typed event bus, the entity registry, core math, viewport and orientation handling,
the input abstraction, the `SceneManager` and `GameState` skeletons, and the content
loader. It contains **no gameplay rules** — it provides the substrate that makes
gameplay deterministic, decoupled, and testable per `architecture.md` §3.

## 2. Scope

### In scope
- Project scaffolding: Vite, strict TypeScript, ESLint/Prettier, Vitest, the
  directory layout, and the `package.json` scripts.
- `main.ts` loop driver: fixed-timestep accumulator + interpolated render.
- `core/rng`: seedable PRNG, serialization.
- `core/clock`: time/`dt` injection plumbing.
- `core/events`: the typed `EventBus`.
- `core/registry`: ECS-lite entity/component store used by combat entities.
- `core/math`: `Vec2` and helpers.
- **Viewport & orientation**: driving resize from `visualViewport`, the safe-area and
  `dvh` page CSS, and the portrait "rotate to landscape" state. It **does not** own
  the 3D renderer or the UI layout — it tells them the viewport changed.
- `input`: **Pointer Events** abstraction (mouse/touch/pen unified) + keyboard →
  typed input events; the **touch-to-aim / hold-to-fire** scheme (`compatibility.md
  §4`); `pointercancel` handling; gesture-hygiene CSS; audio-unlock hook.
- `state/scene-manager` + `state/game-state` **skeletons** (lead-owned shared types).
- `content/loader`: load + validate `src/content` data tables at boot.
- **Quality-gate infrastructure** (per `testing.md`): `.github/workflows/ci.yml`, the
  custom ESLint rules (no focused/skipped tests, no bare `any`/`@ts-ignore`/
  `eslint-disable`), the committed coverage thresholds, the **StrykerJS** mutation
  config, a lightweight **pre-push** hook running `npm run check`, and the
  **determinism golden** harness (`/tests`).
- **Cross-browser test harness** (per `compatibility.md §8`): the `@playwright/test`
  config and project matrix (Chromium + WebKit + Firefox + emulated iPhone).

### Out of scope (owned elsewhere)
- Any gameplay rules: drones, meters, economy, scoring, incidents (their areas).
- Concrete scene implementations beyond `Boot`/empty placeholders (UI + Gameplay).
- Concrete content table *contents* (each domain owns its tables); this area owns
  only the loader + validation framework.
- All rendering — the three.js scene and camera (Art), the DOM interface (HUD & UI).
  This area owns neither, and owns no screen↔world projection: that belongs to the
  view that owns the camera.
- Audio engine internals (Audio area) — only the unlock hook lives here.

## 3. Requirements & mechanics

### 3.1 Build & tooling
1. Vite project, ES modules, TypeScript `strict: true`, `noUncheckedIndexedAccess`,
   `noImplicitOverride`, `exactOptionalPropertyTypes` on.
2. `package.json` scripts (exact names — referenced by `architecture.md` §7):
   - `dev` → `vite`
   - `build` → `tsc --noEmit && vite build`
   - `preview` → `vite preview`
   - `test` → `vitest run`
   - `test:watch` → `vitest`
   - `lint` → `eslint .`
   - `typecheck` → `tsc --noEmit`
   - `check` → `tsc --noEmit && eslint . && vitest run` (the CI gate)
3. `vitest.config.ts`: `environment: 'jsdom'` available per-file via
   `// @vitest-environment jsdom`; default `node` for pure-logic speed. Coverage via
   `@vitest/coverage-v8`, thresholds wired so logic dirs meet **≥85% lines, branches,
   AND functions** (`testing.md §3`).
4. Directory layout exactly as `architecture.md` §2.
5. **Quality gates (`testing.md`).** Additional scripts: `test:e2e` →
   `playwright test`; `test:mutation` → `stryker run`. ESLint adds
   `eslint-plugin-vitest` (`no-focused-tests`, `no-disabled-tests`, `expect-expect`),
   `@typescript-eslint/no-explicit-any`, `ban-ts-comment`, and
   `eslint-comments/require-description`. CI (`.github/workflows/ci.yml`) runs
   `npm run check` + `npm run test:e2e` (the matrix) + the content-lint on every PR;
   mutation runs on logic-touching PRs and nightly. A pre-push hook runs `npm run
   check`. `CODEOWNERS` guards `*.test.ts`, `/tests`, the threshold configs, and the
   area docs so gates can't be loosened unreviewed.

### 3.2 Game loop (main.ts)
Fixed-timestep accumulator, decoupled from display refresh, interpolated render:

```
FIXED_DT = 1/60 s
MAX_FRAME = 0.25 s         // clamp to avoid spiral-of-death after a tab stall
accumulator = 0
prevTime = now()           // ONLY place real clock is read
loop(now):
  frame = min(now - prevTime, MAX_FRAME)
  prevTime = now
  accumulator += frame
  while accumulator >= FIXED_DT:
    scene.update(FIXED_DT, ctx)     // deterministic, dt is constant
    accumulator -= FIXED_DT
  alpha = accumulator / FIXED_DT   // 0..1 interpolation factor
  manager.render(alpha)            // see §3.10
  requestAnimationFrame(loop)
```
- Logic only ever sees `FIXED_DT`. Frame-rate independence and determinism follow.
- `alpha` lets the presentation interpolate entity positions between logic ticks. It
  is passed **as an argument** to `render`, so the loop and every scene agree without
  a shared mutable renderer object.
- Pause stops calling `update` but may keep rendering.

### 3.3 RNG (core/rng)
1. Algorithm: **mulberry32** (32-bit, fast, tiny state) seeded from a `number`.
2. `Math.random()` is **banned in logic** (architecture §3.2): it is non-reproducible
   and unseedable, so it breaks deterministic tests and run replays. Lint rule
   forbids it in `src/systems`, `src/content`, `src/state`.
3. State is a single integer so a whole run's randomness can be serialized.

### 3.4 Clock / time injection (core/clock)
- Only `main.ts` reads `performance.now()`. Systems receive `dt` (seconds).
- A `Clock` helper accumulates `shiftSeconds` and exposes it via the `time` slice;
  tests advance time purely by feeding chosen `dt` values to `update`.

### 3.5 Event bus (core/events)
- Typed over the `GameEvents` map (architecture §5). `emit` is type-checked against
  the payload; `on` returns an unsubscribe function; `off` removes a handler.
- Synchronous dispatch (deterministic ordering). Handlers added during emit do not
  fire for the in-flight event. Errors in one handler must not abort the others.

### 3.6 Entity registry (core/registry)
- **ECS-lite**: numeric entity ids + typed component maps (`Map<EntityId, C>` per
  component). Chosen over a class hierarchy for cheap iteration and easy
  serialization. Supports create/destroy, add/remove component, query-by-component.
- Used by Gameplay Engine for drones/projectiles/pickups. Registry itself is
  gameplay-agnostic.

### 3.7 Math (core/math)
- Immutable-friendly `Vec2` ops (add, sub, scale, len, normalize, dot, angle,
  rotate, lerp, dist), `clamp`, `lerp`, `approach(value, target, maxDelta)`.

### 3.8 Viewport & orientation
- The game renders at the **device's native resolution**. There is no fixed internal
  resolution, no integer scaling, and no letterboxing. The simulation still runs in a
  fixed **384×216 arena coordinate space**, but that is a *logical* space owned by the
  simulation — it is not a framebuffer size and nothing scales pixels to it.
- **Screen↔world mapping is not owned here.** Turning a pointer position into an aim
  point requires the camera, so it belongs to the view that owns the camera
  (`ThreeView.screenToWorld`, area 11). Core delivers pointer positions in CSS pixels
  relative to the canvas and stays out of the projection business.
- Pointer coordinates are computed from `getBoundingClientRect()` +
  `clientX/clientY` — **not** `offsetX/offsetY`, which differ across browsers.
- **Viewport source & reflow:** resize is driven by `window.visualViewport`
  (fallback `window.inner*`), re-run on `visualViewport` `resize` + `orientationchange`
  + `resize` (debounced) so the iOS Safari URL-bar show/hide doesn't clip the view.
  Page CSS uses `100dvh` (fallback `100vh`), `viewport-fit=cover`, and
  `env(safe-area-inset-*)` padding (`compatibility.md §3`).
- **Orientation:** the game is landscape; on a portrait phone a "rotate to landscape"
  overlay is shown (orientation lock is unavailable on iOS Safari — prompt, don't
  force). Fullscreen is not assumed (unavailable on iPhone).

### 3.9 Input
- Abstraction over **Pointer Events** (`pointerdown`/`move`/`up`/`cancel` — one source
  unifying mouse, touch, and pen) + keyboard → typed `InputEvent`s delivered to the
  active scene's `onInput`. Tracks held state for continuous aim/fire. Includes the
  **audio-unlock-on-first-gesture** hook (resumes `AudioContext`; Audio area consumes
  the signal).
- **Touch control scheme (`compatibility.md §4`): touch-to-aim, hold to fire.** A
  primary `pointerdown` in the play area aims at that world point and emits `fireDown`;
  `pointermove` re-aims; `pointerup` emits `fireUp`. **`pointercancel` MUST emit
  `fireUp`** (iOS fires it on call/notification/system-gesture interruption — otherwise
  the gun sticks firing). Only the primary pointer aims/fires; secondary pointers are
  ignored (or routed to the HUD intercom button). Desktop mouse (hover-aim + held
  button) and keyboard (A/D rotate + Space fire) paths are retained.
- **Gesture hygiene:** the WebGL canvas and the UI root set `touch-action: none`,
  `user-select: none` (+ `-webkit-` variants), `-webkit-touch-callout: none`, and
  `preventDefault` pointer/touch to suppress scroll, double-tap-zoom,
  pull-to-refresh, and long-press callout.

### 3.10 Scene manager & GameState skeletons
- This area **publishes the lead-owned contracts** — `Scene<P>`, `SceneId`, `SceneManager`,
  and the `GameState` skeleton (`architecture.md` §4) — plus a trivial `Boot`
  placeholder scene. A scene's render hook is **`render(alpha: number)`**: scenes do not
  draw, they update presentation objects that draw themselves. **State & Persistence (09)
  implements the `SceneManager` FSM** (transition graph, overlays, lifecycle,
  `enter/exit/update/render/routeInput` dispatch); this area does not duplicate that logic.
- These contracts are **lead-owned**; other areas refine only their own `GameState` slice.

### 3.11 Content loader
- Loads typed data tables from `src/content`, runs a validation pass, and fails
  **loudly at boot** on malformed data (never silently). Provides the validated
  `Content` object inside `SystemContext`.

## 4. Public interface (TypeScript)

```ts
// core/rng.ts
export interface RngState { seed: number; }
export interface Rng {
  next(): number;                       // [0,1)
  int(minInclusive: number, maxExclusive: number): number;
  range(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  chance(p: number): boolean;
  getState(): RngState;
  setState(s: RngState): void;
}
export function createRng(seed: number): Rng;

// core/clock.ts
export interface Clock { shiftSeconds: number; advance(dt: number): void; }
export function createClock(): Clock;

// core/events.ts
export type Handler<T> = (payload: T) => void;
export interface EventBus {
  on<K extends keyof GameEvents>(k: K, h: Handler<GameEvents[K]>): () => void;
  off<K extends keyof GameEvents>(k: K, h: Handler<GameEvents[K]>): void;
  emit<K extends keyof GameEvents>(k: K, payload: GameEvents[K]): void;
}
export function createEventBus(): EventBus;

// core/registry.ts
export type EntityId = number;
export interface Registry {
  create(): EntityId;
  destroy(id: EntityId): void;
  add<C>(id: EntityId, key: string, c: C): void;
  get<C>(id: EntityId, key: string): C | undefined;
  remove(id: EntityId, key: string): void;
  with(...keys: string[]): EntityId[];
  all(): EntityId[];
}
export function createRegistry(): Registry;

// core/math.ts
export interface Vec2 { x: number; y: number; }
export const v2: { add; sub; scale; len; norm; dot; angle; rotate; lerp; dist };
export function clamp(x: number, lo: number, hi: number): number;
export function approach(value: number, target: number, maxDelta: number): number;

// input/input.ts
export type InputEvent =
  | { type: 'aim'; world: Vec2 }
  | { type: 'fireDown' } | { type: 'fireUp' }
  | { type: 'key'; code: string; down: boolean }
  | { type: 'pointer'; world: Vec2; down: boolean };
export interface Input { isDown(code: string): boolean; dispose(): void; }

// There is no `Renderer` contract. Presentation is owned by two independent layers:
// the three.js view (area 11) and the DOM UI (area 10). Scenes receive only the
// fixed-timestep interpolation factor and update those layers.

// state/scene.ts + state/scene-manager.ts
// CANONICAL contract — reconciled to State & Persistence (09), which IMPLEMENTS the FSM. Scenes
// (and any repos they need) are supplied to register() via FACTORY closures; repos are NOT placed
// on SystemContext (that Core type stays free of the persistence layer).
export interface Scene<P = void> {
  enter(params: P, ctx: SystemContext): void;   // typed transition params (see 09's SceneParams)
  update(dt: number, ctx: SystemContext): void; // not called while frozen beneath an overlay
  render(alpha: number): void;                  // 0..1 interpolation factor; a scene does not draw
  onInput(e: InputEvent): void;
  exit(): void;
}
export type SceneId =
  | 'Boot' | 'MainMenu' | 'Playing' | 'Paused'
  | 'GameOver' | 'HighscoreEntry' | 'Highscores' | 'Settings';
export interface SceneManager {
  register<P>(id: SceneId, factory: () => Scene<P>): void;  // FACTORY → fresh scene per entry
  transition<P>(to: SceneId, params?: P): void;             // validates against the FSM edges
  pushOverlay<P>(to: SceneId, params?: P): void;            // Pause/modal — does not exit active
  popOverlay(): void;
  readonly active: SceneId; readonly overlay: SceneId | null;
  update(dt: number, ctx: SystemContext): void;
  render(alpha: number): void;
  routeInput(e: InputEvent): void;
}
export function createSceneManager(ctx: SystemContext, initial?: SceneId): SceneManager;

// content/loader.ts
export function loadContent(raw: unknown): Content;   // throws on invalid data
```

`SystemContext` and `GameState` are defined here per `architecture.md` §4.

## 5. Data / content tables

This area defines no gameplay content. It owns the **loader and validation
framework** plus the `Content` aggregate type that domain tables (drones, residents,
incidents, balance) slot into. Each domain area registers its table schema; the
loader validates all registered schemas at boot.

## 6. Persistence

None directly. This area exposes the injectable `Storage` interface shape (consumed
by the State & Persistence area), but does not write to `localStorage`.

## 7. Dependencies & integration

- **Provides to all areas:** `SystemContext` (`rng`, `events`, `content`), the loop,
  the registry, math, viewport/orientation handling, input, `SceneManager`,
  `GameState` skeleton.
- **Emits:** none of the gameplay events itself; it provides the bus.
- **Consumes:** the audio-unlock signal is forwarded to the Audio area; scenes are
  supplied by Gameplay/UI areas via `register`.

## 8. Required automated tests (MUST pass)

All tests deterministic; no wall-clock, no real timers, no `Math.random`. `npm run
check` (typecheck + lint + `vitest run`) must be green (architecture §7).

1. **RNG determinism:** same seed → identical `next()` sequence; two instances with
   the same seed stay in lockstep; `getState`/`setState` round-trip reproduces the
   exact continuation; distribution sanity for `int`/`range`/`pick`/`chance`.
2. **Loop accumulator:** feeding a large frame `dt` runs the correct integer number
   of fixed steps; `dt` smaller than `FIXED_DT` accumulates without stepping; a
   frame above `MAX_FRAME` is clamped (no spiral-of-death); `alpha` ∈ [0,1).
3. **Event bus:** `emit` invokes subscribers with correctly typed payloads;
   unsubscribe via returned fn and via `off` stops delivery; a throwing handler does
   not prevent other handlers from running; handlers added mid-emit don't fire for
   the in-flight event.
4. **Registry:** create/destroy lifecycle; add/get/remove components; `with(...)`
   returns only entities having all keys; destroyed ids are not returned.
5. **Viewport & pointer coordinates:** resize is computed from the `visualViewport`
   size with the `window.inner*` fallback; pointer positions are derived from a rect
   origin + `clientX/Y` (not `offsetX/Y`); a portrait viewport yields the "rotate"
   state and a landscape one clears it.
6. **Scene contract & `Boot` placeholder:** the `Scene`/`SceneManager` types compile,
   `render` takes the interpolation factor, and the `Boot` placeholder's lifecycle
   methods are callable. (The FSM transition tests — legal/illegal edges, lifecycle
   order, overlays — are owned by **State & Persistence (09)**, which implements the
   manager.)
7. **Content loader:** valid tables load; malformed tables (missing field, wrong
   type, out-of-range) fail loudly with a clear error; loader output is the typed
   `Content`.
8. **Input mapping (jsdom):** synthetic keyboard/pointer events produce the expected
   typed `InputEvent`s; held state tracked; audio-unlock hook fires once on first
   gesture. **Touch scheme:** `pointerdown` emits aim+`fireDown`, `pointermove`
   re-aims, `pointerup` emits `fireUp`, and **`pointercancel` emits `fireUp`** (no
   stuck fire); secondary pointers don't hijack the primary aim.
9. **Determinism golden (`/tests`, `testing.md §6`):** a fixed-seed, scripted-input
   headless run for K ticks hashes to a committed golden `GameState`.
10. **Cross-browser matrix (`compatibility.md §8`):** the Playwright config boots the
    app and runs the minimum suite on Chromium + WebKit + Firefox + emulated iPhone;
    this is a required CI gate, not an optional smoke test.

## 9. Acceptance criteria / Definition of done

On top of the global DoD (`architecture.md` §9):
- `npm run dev` boots to a `Boot` scene that fills the viewport at native resolution,
  is crisp on a high-DPI display, and reflows correctly on viewport/orientation change.
- `npm run check` is green with coverage ≥85% (lines/branches/functions) on `core/`
  and the loader; the **Playwright matrix** and the **determinism golden** pass in CI.
- The quality-gate infra is in place and enforcing (`testing.md`): CI workflow,
  custom ESLint rules, committed thresholds, Stryker config, pre-push hook, CODEOWNERS.
- No `Math.random()` / `Date.now()` / `performance.now()` outside `main.ts` (enforced
  by lint).
- Input works via Pointer Events on both touch and desktop; `pointercancel` cannot
  leave the gun stuck firing; gesture-hygiene CSS suppresses scroll/zoom on the
  canvas and the UI root.
- Skeletons (`GameState`, `SceneManager`, `SystemContext`, `EventBus`, `Storage`
  interface) are published and stable for other areas to import.

## 10. Open questions / risks

- The **384×216 arena space** is now purely a simulation coordinate system, not a
  resolution. Watch for code or docs that still treat it as a framebuffer size — that
  confusion is the most likely source of layout bugs during and after the migration.
- Decide whether the registry needs archetype iteration for performance, or whether
  per-component `Map` iteration is sufficient at expected entity counts.
- Touch/mobile input fidelity: **no longer deferred — mobile is a first-class target.**
  The scheme is touch-to-aim / hold-to-fire (`compatibility.md §4`). Open sub-question:
  tune the touch aim feel (direct-to-finger vs. a small offset so the finger doesn't
  occlude the target) during playtests; coordinate with Gameplay Engine.
- Replay/serialization: do we want full-run replay from seed + input log? If so,
  the input layer must also be recordable — flag now so it isn't retrofitted later.
