# Area: Core Platform & Build

**Owner:** <unassigned> · **Depends on:** none · **Depended on by:** all areas

## 1. Purpose

The Core Platform is the foundation every other area plugs into. It owns the build
toolchain, the deterministic game loop, the seedable RNG, the injected clock, the
typed event bus, the entity registry, core math, the canvas scaler, the input
abstraction, the `SceneManager` and `GameState` skeletons, and the content loader.
It contains **no gameplay rules** — it provides the substrate that makes gameplay
deterministic, decoupled, and testable per `architecture.md` §3.

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
- `render/scaler`: internal-resolution canvas, integer scaling, screen↔world mapping.
- `input`: keyboard + pointer abstraction → typed input events; audio-unlock hook.
- `state/scene-manager` + `state/game-state` **skeletons** (lead-owned shared types).
- `content/loader`: load + validate `src/content` data tables at boot.

### Out of scope (owned elsewhere)
- Any gameplay rules: drones, meters, economy, scoring, incidents (their areas).
- Concrete scene implementations beyond `Boot`/empty placeholders (UI + Gameplay).
- Concrete content table *contents* (each domain owns its tables); this area owns
  only the loader + validation framework.
- Rendering of sprites/HUD/menus (Render, HUD, UI areas) — scaler only.
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
   `@vitest/coverage-v8`, thresholds wired so logic dirs meet ≥85% (architecture §7).
4. Directory layout exactly as `architecture.md` §2.

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
  alpha = accumulator / FIXED_DT     // 0..1 interpolation factor
  scene.render(renderer, alpha)
  requestAnimationFrame(loop)
```
- Logic only ever sees `FIXED_DT`. Frame-rate independence and determinism follow.
- `alpha` lets the renderer interpolate entity positions between logic ticks.
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

### 3.8 Scaler (render/scaler)
- Internal resolution **384×216**; backing canvas is that size, CSS-scaled by the
  largest integer that fits the viewport (letterboxed), `image-rendering: pixelated`,
  `ctx.imageSmoothingEnabled = false`.
- `screenToWorld` / `worldToScreen` for aiming the gun with the pointer; account for
  integer scale + letterbox offset.

### 3.9 Input
- Abstraction over keyboard + mouse/pointer (and basic touch) → typed `InputEvent`s
  delivered to the active scene's `onInput`. Tracks held-key state for continuous
  aim/fire. Includes the **audio-unlock-on-first-gesture** hook (resumes
  `AudioContext`; Audio area consumes the signal).

### 3.10 Scene manager & GameState skeletons
- `SceneManager` runs the FSM in `architecture.md` §6; validates transitions; calls
  `enter/exit/update/render/onInput`.
- `GameState` skeleton per `architecture.md` §4. These are **lead-owned**; other
  areas refine only their own slice.

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

// render/scaler.ts
export interface Scaler {
  readonly width: 384; readonly height: 216; readonly scale: number;
  resize(viewportW: number, viewportH: number): void;
  screenToWorld(sx: number, sy: number): Vec2;
  worldToScreen(w: Vec2): Vec2;
}

// input/input.ts
export type InputEvent =
  | { type: 'aim'; world: Vec2 }
  | { type: 'fireDown' } | { type: 'fireUp' }
  | { type: 'key'; code: string; down: boolean }
  | { type: 'pointer'; world: Vec2; down: boolean };
export interface Input { isDown(code: string): boolean; }

// state/scene-manager.ts
export interface Scene {
  enter(ctx: SystemContext): void;
  update(dt: number, ctx: SystemContext): void;
  render(r: Renderer, alpha: number): void;
  onInput(e: InputEvent): void;
  exit(): void;
}
export type SceneId =
  | 'Boot' | 'MainMenu' | 'Playing' | 'Paused'
  | 'GameOver' | 'HighscoreEntry' | 'Highscores' | 'Settings';
export interface SceneManager {
  register(id: SceneId, scene: Scene): void;
  transition(to: SceneId): void;     // validates against allowed FSM edges
  current(): SceneId;
}

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
  the registry, math, scaler, input, `SceneManager`, `GameState` skeleton.
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
5. **Scaler math:** integer scale selection for several viewport sizes (incl.
   letterbox); `screenToWorld`∘`worldToScreen` is identity within rounding; mapping
   respects letterbox offset.
6. **Scene transitions:** allowed FSM edges succeed; disallowed transitions are
   rejected/throw; `enter`/`exit` fire in the right order.
7. **Content loader:** valid tables load; malformed tables (missing field, wrong
   type, out-of-range) fail loudly with a clear error; loader output is the typed
   `Content`.
8. **Input mapping (jsdom):** synthetic keyboard/pointer events produce the expected
   typed `InputEvent`s; held-key state tracked; audio-unlock hook fires once on first
   gesture.

## 9. Acceptance criteria / Definition of done

On top of the global DoD (`architecture.md` §9):
- `npm run dev` boots to a blank/`Boot` scene at 384×216 integer-scaled.
- `npm run check` is green with coverage ≥85% on `core/` and the loader.
- No `Math.random()` / `Date.now()` / `performance.now()` outside `main.ts` (enforced
  by lint).
- Skeletons (`GameState`, `SceneManager`, `SystemContext`, `EventBus`, `Storage`
  interface) are published and stable for other areas to import.

## 10. Open questions / risks

- Confirm internal resolution 384×216 vs 320×180 with the Art area before locking
  HUD layout.
- Decide whether the registry needs archetype iteration for performance, or whether
  per-component `Map` iteration is sufficient at expected entity counts.
- Touch/mobile input fidelity: how precise must aiming be on touch? Defer unless a
  target platform requires it.
- Replay/serialization: do we want full-run replay from seed + input log? If so,
  the input layer must also be recordable — flag now so it isn't retrofitted later.
