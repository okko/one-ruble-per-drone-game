# Area: State & Persistence

**Owner:** <unassigned> · **Depends on:** Core Platform & Build · **Depended on by:** Gameplay Engine, Main Menu, Highscores, Settings/Audio, HUD & UI (everything routes through the scene machine and reads/writes storage)

## 1. Purpose

This area owns the two pieces of "spine" that the rest of the game plugs into: (a)
the **app state machine** (`SceneManager`) that sequences the player between Boot,
menus, gameplay, pause, game-over and highscore screens; and (b) the **persistence
layer** — a versioned, migration-aware wrapper over `localStorage` plus the typed
repositories (highscores, settings, meta-stats) that every other area reads from and
writes to. Both skeletons are **lead-owned**: other areas implement scenes and
consume repositories, but they do not change these contracts without sign-off.

## 2. Scope

### In scope
- The `SceneManager` finite state machine: scene registry, legal transition graph,
  transition guards, and the push/replace/transition API.
- The `Scene` interface that all scenes (menu, gameplay, etc.) implement.
- Pause/resume semantics (overlay a paused gameplay scene without tearing it down).
- The `Storage` wrapper: namespaced keys, JSON (de)serialization, top-level schema
  `VERSION`, a migrations chain, corrupt/missing-data tolerance, and an injectable
  backend with an in-memory fallback.
- The three repositories built on `Storage`: `HighscoresRepo`, `SettingsRepo`,
  `MetaStatsRepo` — their interfaces, stored schemas, and key names.
- The save/load lifecycle policy (when each repo is written).

### Out of scope (owned elsewhere)
- The **visual/interaction content** of each scene — the actual menu layout,
  highscore table rendering, gameplay loop, settings widgets. This area provides the
  `Scene` contract and the manager; the respective areas (Main Menu, Highscores,
  Gameplay Engine, HUD/UI, Audio) author the scenes themselves.
- **What** data lives in highscore entries beyond the agreed schema (Highscores
  area refines presentation), and **what** settings mean at runtime (Audio/Input
  apply them). This area only defines storage shape and access.
- The seedable RNG, event bus, fixed-timestep loop driver, and `GameState`
  skeleton — those are Core Platform & Build (`core/`).

## 3. Requirements & mechanics

### 3.1 Scene machine
1. The app is always in exactly one **active scene**, with an optional **overlay**
   scene stacked on top (used for Pause and modal dialogs).
2. Scenes and legal transitions (see architecture.md §6):

   ```
   Boot          → MainMenu
   MainMenu      → Playing | Highscores | Settings
   Playing       → Paused (overlay) | GameOver
   Paused        → Playing (resume) | MainMenu (abandon run)
   GameOver      → HighscoreEntry (if score qualifies) | Highscores | MainMenu
   HighscoreEntry→ Highscores
   Highscores    → MainMenu
   Settings      → MainMenu
   ```
3. **Illegal transitions are rejected** (e.g. `MainMenu → GameOver`,
   `Boot → Settings`). The manager validates against the transition graph and
   throws/logs a guarded error rather than silently switching. Tests assert this.
4. **Pause** is special: it does **not** exit `Playing`. The gameplay scene stays
   mounted (its `update` is no longer called, its `render` may still be called so the
   frozen scene shows behind the pause overlay). **Resume** pops the overlay and
   restores `update` calls. "Abandon run" from Pause performs a real transition to
   `MainMenu` and calls `Playing.exit()`.
5. **Lifecycle ordering** on a transition `A → B`: call `A.exit()`, then construct/
   reset `B`, then `B.enter(params)`. Overlays call `enter`/`exit` without exiting
   the scene beneath.
6. The manager owns the per-frame fan-out: `update(dt, ctx)` and `render(r)` are
   dispatched to the active scene (and overlay where appropriate). Input events are
   routed to the topmost scene (overlay first, else active).
7. Transition **parameters** are typed and passed into `enter` (e.g. `GameOver`
   receives `{ score, cause }`; `HighscoreEntry` receives `{ score, rank }`).

### 3.2 Persistence layer
8. All persisted data lives under a single namespace prefix (e.g. `orpd:`) so we
   never collide with other localStorage users; each repo gets its own key.
9. A single top-level **schema `VERSION`** integer is stored. On load, if the stored
   version is lower, the **migrations chain** runs in order (`v1→v2→v3…`), each a
   pure `(data) => data` transform, then the upgraded blob is re-saved with the new
   version. Unknown/newer versions are tolerated (load defaults rather than crash).
10. **Corrupt or missing data never crashes the game.** A failed `JSON.parse`, a
    schema mismatch, or a thrown backend call resolves to that repo's documented
    **defaults**.
11. The backend is **injectable**. Production uses `localStorage`; tests and
    private-mode/quota-exceeded situations use an **in-memory backend**. The wrapper
    detects an unavailable/throwing `localStorage` at construction and transparently
    falls back to in-memory (the game still runs; data just doesn't persist across
    reloads).

### 3.3 Save/load lifecycle
12. **No mid-run autosave of the live `GameState` by default.** A run is ephemeral;
    quitting or reloading mid-shift abandons it. (Noted as an explicit design
    decision; a resumable-run feature is a future option, out of scope here.)
13. **Settings** are written immediately on change (debounced is fine) and read once
    at Boot.
14. **MetaStats** and **Highscores** are written **on game over only**: the
    `gameOver` event updates lifetime stats (drones downed, best shift length,
    last-run summary) and, if the score qualifies, the run flows through
    `HighscoreEntry` which writes the new highscore entry.
15. The **seen-intro flag** (MetaStats) is written the first time Boot completes its
    intro, so returning players skip it.

## 4. Public interface (TypeScript)

```ts
// src/state/scene.ts
export interface Scene<P = unknown> {
  enter(params: P, ctx: SystemContext): void;
  update(dt: number, ctx: SystemContext): void;   // not called while paused/overlaid
  render(r: Renderer): void;
  onInput(e: InputEvent): void;
  exit(): void;
}

export type SceneId =
  | 'Boot' | 'MainMenu' | 'Playing' | 'Paused'
  | 'GameOver' | 'HighscoreEntry' | 'Highscores' | 'Settings';

// src/state/scene-manager.ts  (LEAD-OWNED skeleton)
export interface SceneManager {
  register(id: SceneId, factory: () => Scene): void;
  /** Replace the active scene (validates against the transition graph). */
  transition<P>(to: SceneId, params?: P): void;
  /** Stack an overlay (e.g. Pause) above the active scene without exiting it. */
  pushOverlay<P>(to: SceneId, params?: P): void;
  popOverlay(): void;
  readonly active: SceneId;
  readonly overlay: SceneId | null;
  update(dt: number, ctx: SystemContext): void;  // dispatches to active (or paused) + overlay
  render(r: Renderer): void;
  routeInput(e: InputEvent): void;
}

/** Legal transitions; manager rejects anything not listed. */
export const TRANSITIONS: Record<SceneId, SceneId[]>;
```

```ts
// src/persistence/storage.ts  (LEAD-OWNED skeleton)
export interface StorageBackend {       // localStorage-shaped, swappable
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface Storage {
  get<T>(key: string, fallback: T): T;          // parse + validate, else fallback
  set<T>(key: string, value: T): void;          // serialize + write (best-effort)
  remove(key: string): void;
}

export function createStorage(
  backend?: StorageBackend,                       // defaults to localStorage, else in-memory
): Storage;

export function createMemoryBackend(): StorageBackend;

export const SCHEMA_VERSION: number;
export type Migration = (data: unknown) => unknown;
export const MIGRATIONS: Migration[];             // index i migrates v(i+1) → v(i+2)
```

```ts
// src/persistence/*-repo.ts
export interface HighscoresRepo {
  list(): HighscoreEntry[];                       // sorted desc, capped at MAX
  qualifies(score: number): boolean;
  rankFor(score: number): number;                 // 1-based, or MAX+1 if not in table
  add(entry: HighscoreEntry): { rank: number };
  clear(): void;
}

export interface SettingsRepo {
  get(): Settings;
  patch(partial: Partial<Settings>): Settings;
  reset(): Settings;
}

export interface MetaStatsRepo {
  get(): MetaStats;
  recordRun(summary: RunSummary): MetaStats;      // updates bestShiftSeconds, totals
  markIntroSeen(): void;
}
```

## 5. Data / content tables

Stored schemas (all under the `orpd:` namespace, JSON-encoded, wrapped with
`{ version, data }`):

```ts
interface HighscoreEntry {
  name: string;            // 3-char initials by default (Highscores area may widen)
  score: number;
  shiftSeconds: number;
  dronesDowned: number;
  dateISO: string;         // wall-clock captured at save time by the caller, not in logic
}

interface Settings {
  masterVolume: number;    // 0..1
  musicVolume: number;     // 0..1
  sfxVolume: number;       // 0..1
  muted: boolean;
  bindings: Record<string, string>;   // action -> key/code; aim binding included
  accessibility: { highContrast: boolean; reducedFlash: boolean; largeHud: boolean };
}

interface MetaStats {
  bestShiftSeconds: number;
  lifetimeDronesDowned: number;
  lifetimeRuns: number;
  lastRun: RunSummary | null;
  introSeen: boolean;
}

interface RunSummary {
  score: number; shiftSeconds: number; dronesDowned: number; cause: string;
}
```

Keys: `orpd:highscores`, `orpd:settings`, `orpd:meta`. Each repo supplies documented
defaults (empty highscore list; mid volumes, unmuted, default bindings; zeroed
stats, `introSeen:false`).

## 6. Persistence

This area **is** the persistence layer. Summary of what is written and when:

| Repo | Key | Written when | Read when |
|---|---|---|---|
| SettingsRepo | `orpd:settings` | on any settings change (Settings/Audio areas) | Boot |
| MetaStatsRepo | `orpd:meta` | on `gameOver` (record run); on intro completion (seen flag) | Boot, MainMenu |
| HighscoresRepo | `orpd:highscores` | on `HighscoreEntry` submit | Highscores scene, GameOver (to test `qualifies`) |

No live-`GameState` autosave (see §3.3 item 12).

## 7. Dependencies & integration

- **Consumes** from Core: `SystemContext` (for `events`), `Renderer`, `InputEvent`
  types, the fixed-timestep driver (which calls `manager.update/render`).
- **Listens to** the `gameOver` event to drive the MetaStats record + GameOver
  transition; the actual emit comes from Gameplay Engine.
- **Provides** the `Scene` contract and `SceneManager` to Gameplay Engine, Main
  Menu, Highscores, Settings, HUD.
- **Provides** repositories to: Highscores (`HighscoresRepo`), Audio/Menu/Input
  (`SettingsRepo`), MainMenu/GameOver (`MetaStatsRepo`).
- Date/time strings (`dateISO`) are supplied **by the caller at save time**, not read
  inside logic, to honor architecture.md §3 (time injected, deterministic logic).

## 8. Required automated tests (MUST pass)

Per architecture.md §7, all tests below must pass (`npm run check` green). Scene
tests use stub scenes; storage tests use the in-memory backend.

**Scene machine**
1. Every transition listed in `TRANSITIONS` is accepted and updates `active`.
2. A representative set of **illegal** transitions is rejected (e.g. `Boot→Settings`,
   `MainMenu→GameOver`, `Highscores→Playing`) — guarded error, `active` unchanged.
3. Lifecycle order on `A→B` is exactly `A.exit()` → `B.enter()` (assert call order
   via spies).
4. **Pause**: `pushOverlay('Paused')` does not call `Playing.exit()`, and
   `Playing.update` stops being called while paused; `popOverlay()` resumes
   `update` calls.
5. "Abandon run" path: `Paused → MainMenu` calls `Playing.exit()` and clears overlay.
6. `enter` receives typed params (e.g. `GameOver` gets `{score, cause}`).
7. Input routing goes to the overlay when present, else the active scene.

**Storage / repos** (in-memory backend)
8. Round-trip per repo: `set`→`get` returns equal value for highscores, settings,
   meta.
9. **Migration**: seed a `v(N-1)` blob, load, assert the migration chain ran and the
   data is upgraded and re-saved at `SCHEMA_VERSION`.
10. **Corrupt JSON**: a non-parseable / wrong-shape blob loads as documented
    defaults without throwing.
11. **Missing key**: `get` returns defaults when the key is absent.
12. **In-memory fallback**: when the backend's `setItem`/`getItem` throws (simulated
    private mode / quota), `createStorage` falls back to in-memory and the game keeps
    working; no exception escapes.
13. **Settings persist & reload**: `patch` writes; a fresh repo over the same backend
    reads the patched values; `reset` restores defaults.
14. **Highscores semantics**: `qualifies`/`rankFor` correct around the cap boundary;
    `add` keeps the list sorted-desc and capped at `MAX`; `clear` empties it.
15. **MetaStats**: `recordRun` updates `bestShiftSeconds` only when improved,
    increments lifetime counters, stores `lastRun`; `markIntroSeen` is idempotent.

## 9. Acceptance criteria / Definition of done

In addition to the global DoD (architecture.md §9):

- [ ] `SceneManager` enforces the §3.1 transition graph; pause/resume works without
      tearing down the gameplay scene.
- [ ] `Storage` is version-aware with a working migrations chain and never throws on
      corrupt/missing/unavailable storage.
- [ ] All three repositories implement their interfaces with documented defaults and
      stable key names under the `orpd:` namespace.
- [ ] Save/load lifecycle matches §3.3 (no live-run autosave; meta/highscore on game
      over; settings on change).
- [ ] All §8 tests authored and passing; logic coverage ≥ 85%.
- [ ] Public API (SceneManager, Storage, repos) documented for downstream areas.

## 10. Open questions / risks

- **Resumable runs:** explicitly out of scope now. If desired later, add a
  `RunStateRepo` and an autosave cadence; flagged so the schema/version design leaves
  room.
- **Highscore name length:** defaulting to 3-char initials (retro). If the Highscores
  area wants full names, widen `HighscoreEntry.name` and bump `SCHEMA_VERSION` with a
  migration. Coordinate before changing the shared schema.
- **Multiple tabs:** concurrent tabs could clobber each other's settings/highscores.
  Acceptable for a single-player browser game; note as a known limitation (could add
  a `storage` event listener later).
- **Date source:** confirm callers pass `dateISO`; ensure no logic module reads the
  clock directly (architecture.md §3).
