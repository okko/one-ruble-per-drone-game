# Area: Gameplay Engine

**Owner:** <unassigned> · **Depends on:** Core Platform & Build, Meters (aim debuffs) · **Depended on by:** Scoring, Random Incidents, HUD, Audio, Economy (ruble grants)

## 1. Purpose

This area owns the `Playing` scene and the core combat fantasy: drones spawn from
the Moscow skyline, the player aims and fires the machine-gun post, drones are
destroyed for **+1 ruble** and points, and drones that slip past damage **Post
Integrity**. It owns the entity simulation (drones, projectiles), the spawn
director, aim/fire mechanics, collision, and the loss condition at the gun. It is
the heartbeat that every other gameplay area reacts to via the event bus.

## 2. Scope

### In scope
- The `Playing` scene (`enter/update/render/onInput/exit`).
- `CombatState` slice: drones, projectiles, gun, post integrity, aim.
- Data-driven **drone types** and the **spawn director** (deterministic, seeded).
- Drone movement/AI paths toward the building.
- Machine-gun aiming, firing, fire-rate/cooldown, overheat, and a **jam hook**.
- Collision detection and damage resolution.
- Granting **+1 ruble** per kill and emitting `droneDestroyed`.
- `droneEscaped` → Post Integrity damage; Post Integrity 0 → `gameOver`.
- Difficulty scaling of spawn rate / speed / HP from `time.difficulty` (`D`).
- Applying meter-driven aim modifiers (computed elsewhere) to effective aim.

### Out of scope (owned elsewhere)
- The **value** of points per drone and combo/multiplier math → Scoring area
  (we only emit `droneDestroyed`/`droneEscaped`; Scoring listens).
- Meter values and the **computation** of aim-debuff magnitudes → Meters area
  (we read a provided `AimModifier`; we do not model fatigue/drunkenness).
- Triggering the gun jam, swarms, blackout effects → Random Incidents area (we
  expose hooks; Incidents drives them).
- Drawing sprites, explosions, parallax skyline → Render/HUD/Art areas (we expose
  render data + emit events; we do not load images).
- Sound → Audio area (reacts to our events).
- Currency display, shop, favors → Economy/HUD (we only mutate `player.rubles`
  via the agreed mechanism and emit `rublesChanged`).

## 3. Requirements & mechanics

### 3.1 The Playing scene
1. Implements the scene interface from `architecture.md` §6:
   `enter()`, `update(dt, ctx)`, `render(r)`, `exit()`, `onInput(e)`.
2. `update` runs at the fixed 60 Hz timestep; all randomness via `ctx.rng`, all
   timing via the passed `dt`. No `Math.random()`, no real clock.
3. Pausing is handled by the SceneManager (we simply stop being `update`d). On
   `enter` we initialize/refresh `CombatState`; on `exit` we release transient
   listeners only (state persists in `GameState`).

### 3.2 Spawn director (deterministic, data-driven)
4. Drone types are defined as data in `src/content/drones.ts` (see §5). The spawn
   director never hard-codes drone stats.
5. Spawning is governed by a **spawn budget / interval model** driven by `D`:
   - `spawnInterval = lerp(BASE_INTERVAL, MIN_INTERVAL, clamp01(D / D_SOFTCAP))`,
     jittered by `±spawnJitter` drawn from `ctx.rng`.
   - On each spawn tick the director picks a drone **kind** via a `D`-weighted
     table (early `D` favors `slow_tank`/`darter`; higher `D` introduces
     `zigzag`, `kamikaze`, and clusters). Selection uses `ctx.rng` only.
   - Concurrent-drone cap rises with `D` to bound CPU and difficulty.
6. **Spawn position:** drones enter from the **skyline edges** (left, right, top,
   and the far rooftops). The director picks an edge and an offscreen point via
   `ctx.rng`, then assigns a path/target (see 3.3). Drones may appear "at any time,
   from any direction" per the GDD.
7. The director exposes a pure step usable in tests:
   `stepSpawns(combat, dt, D, rng) -> SpawnCommand[]` so a given `(seed, D, dt
   sequence)` yields an identical spawn stream.
8. Incident hooks: the director accepts an injected **spawn multiplier / forced
   wave** (e.g. "major drone attack" multiplies rate and queues a boss). This is a
   field on `CombatState.director` that the Incidents area sets and clears.

### 3.3 Drone types, movement & AI
9. Initial roster (data; tune later). All `hp`/`speed`/`points` are base values
   scaled by `D` at spawn (see 3.6):

   | kind | hp | speed | path | notes |
   |---|---|---|---|---|
   | `slow_tank` | high | slow | straight-ish glide toward building | bullet sponge; big, easy to hit |
   | `darter` | low | fast | direct dash | punishes slow aim |
   | `zigzag` | low–med | med | sinusoidal lateral weave | hard to track |
   | `kamikaze` | low | accelerating | locks a dive line toward the post | high `droneEscaped` damage if it lands |
   | `decoy_bird` | 1 | med | wandering, never targets building | **shooting it is penalized** (Incidents/Scoring); does not damage post |
   | `boss` (incident) | very high | slow, phased | multi-segment approach | only via "major drone attack" incident |

10. Movement is computed each tick from a per-drone `MovementProfile` (target
    point, lateral wave params, acceleration). Profiles are pure functions of the
    drone's spawn parameters + elapsed time, so they are reproducible.
11. A drone is **resolved** in one of two ways: destroyed by the player (hp ≤ 0) or
    it reaches its building target → **escape**.

### 3.4 The machine gun — aiming
12. **Primary aim:** pointer (mouse/touch) position defines the **desired aim
    angle** from the gun pivot. The gun barrel rotates toward that angle at a
    finite **turn rate** (so flick-aim has weight and meter sway matters).
13. **Keyboard fallback:** Left/Right (or A/D) rotate the barrel at the turn rate;
    this must be fully playable without a pointer (accessibility + tests).
14. **Effective aim** = desired aim + `AimModifier` offset (see 3.7). The gun fires
    along the **effective** angle, not the raw desired angle.

### 3.5 The machine gun — firing, cooldown, overheat, jam
15. Firing is **continuous while the fire input is held** (mouse button / Space),
    gated by a **fire interval** (`1 / fireRate`). `fireRate` is a tuned constant.
16. **Overheat (chosen over finite ammo):** the gun has a 0–100 `heat` value.
    Firing adds heat per shot; not firing cools it. At `heat >= 100` the gun
    **overheats** and locks until heat falls below a `cooloffResume` threshold.
    Rationale: a machine-gun post realistically overheats, it needs no ammo
    economy (rubles are already the economy), it creates a natural fire-discipline
    skill layer, and it self-regulates difficulty without a pickup loop. Finite
    ammo would add a second scarcity system competing with the ruble economy and
    is therefore rejected.
17. **Jam hook:** `gun.jammed: boolean` plus `gun.jamClearProgress`. When the
    Incidents area sets `jammed = true` (electrical incident), firing is disabled;
    the player clears it by mashing the fire/clear input (accumulating
    `jamClearProgress` to a threshold) or buying the "gun-jam clearing" resident
    service. We expose `setJam()/clearJam()` for Incidents/Economy to call; we own
    the clearing mechanic.

### 3.6 Difficulty scaling (reads `time.difficulty`)
18. Read-only consumer of `GameState.time.difficulty` (`D`); never writes it. `D`
    rises over the shift (owned by Core/Difficulty) and may jump during incidents.
19. Scaling functions (constants in `src/content/balance.ts`):
    - `effectiveSpawnInterval(D)` — decreases with `D` (more drones).
    - `speedScale(D) = 1 + D * kSpeed` — drones get faster.
    - `hpScale(D)   = ceil(baseHp * (1 + D * kHp))` — drones get tougher.
    - `kindWeights(D)` — shifts the spawn mix toward harder kinds.
    - `concurrentCap(D)` — more simultaneous drones.
    All are pure and unit-tested at sample `D` values.

### 3.7 Aim modifiers from meters (consumed, not computed)
20. The Meters area computes an `AimModifier` describing how the soldier's body
    degrades aim. The engine consumes it each tick and applies it to effective aim:
    ```ts
    interface AimModifier {
      swayAmplitude: number;   // radians; sleep + hunger + vice contribute
      swayFrequency: number;   // Hz; how fast the reticle drifts
      drunkWobble: number;     // radians; vodka — larger, slower, lurching
      steadinessPenalty: number; // 0..1 scales turn rate down (sluggish)
    }
    ```
21. The engine derives a deterministic time-based offset from these params (phase
    seeded from `ctx.rng` at run start, advanced by `dt`) — **no `Math.random()`
    per frame**, so a given `(AimModifier, dt sequence, seed)` is reproducible and
    testable. If Meters supplies a zeroed modifier, aim is perfectly steady.
22. The engine does **not** decide what raises sway; it only applies the supplied
    numbers. This keeps the fatigue model entirely in the Meters area.

### 3.8 Kills, rubles, escapes, and loss
23. On drone destruction by the player: set hp ≤ 0, remove the drone next tick,
    grant **+1 ruble** (`player.rubles += 1`, applying debt repayment rules owned
    by Economy — we call the agreed `grantRuble()` helper) and emit:
    - `droneDestroyed { id, kind, byPlayer: true, pos }`
    - `rublesChanged { delta: +1, total }`
    - a `spawnExplosion(pos, kind)` **render hook** and let Audio react to the
      event (we do not play sound directly).
24. **Decoy/bird** destruction emits `droneDestroyed { byPlayer: true, kind:
    'decoy_bird' }` but grants **no ruble**; Scoring/Incidents apply the penalty.
25. On escape (drone reaches building target): emit `droneEscaped { id, damage }`
    and reduce **Post Integrity** by the drone's `escapeDamage`.
26. **Post Integrity:** `combat.postIntegrity` is `0–100`, starts at `100`. It is
    the gun-side loss condition. When it reaches `0`, emit
    `gameOver { score, cause: 'post-destroyed' }` exactly once and stop spawning.
    (The score value is read from the Scoring slice for the payload.)
27. Post Integrity is separate from the body-meter game-over rules owned by Meters;
    either path can end the run.

## 4. Public interface (TypeScript)

```ts
// src/systems/combat/types.ts
export interface CombatState {
  drones: Drone[];
  projectiles: Projectile[];     // empty if hitscan model chosen (see §below)
  gun: GunState;
  aim: { desiredAngle: number; effectiveAngle: number };
  postIntegrity: number;         // 0..100, starts 100
  director: SpawnDirectorState;  // interval timer, rng cursor, incident overrides
  nextDroneId: number;
  gameOverEmitted: boolean;
}

export interface GunState {
  pivot: Vec2;
  angle: number;          // current barrel angle (rad)
  turnRate: number;       // rad/s (scaled by AimModifier.steadinessPenalty)
  fireRate: number;       // shots/s
  fireCooldown: number;   // s until next allowed shot
  heat: number;           // 0..100
  jammed: boolean;
  jamClearProgress: number;
  firing: boolean;
}

export interface Drone {
  id: number;
  kind: string;           // key into content/drones
  pos: Vec2; vel: Vec2;
  hp: number; maxHp: number;
  radius: number;
  movement: MovementProfile;
  escapeDamage: number;
  awardsRuble: boolean;   // false for decoy_bird
}

// Spawn director (pure, testable)
export function stepSpawns(combat: CombatState, dt: number, D: number, rng: Rng): SpawnCommand[];

// Scene
export const playingScene: Scene; // enter/update(dt,ctx)/render(r)/exit/onInput(e)

// Incident/Economy hooks
export function setJam(combat: CombatState, jammed: boolean): void;
export function applySpawnOverride(combat: CombatState, override: SpawnOverride | null): void;

// Aim
export function applyAimModifier(gun: GunState, desired: number, mod: AimModifier, tSeconds: number, rng: Rng): number;
```

### Projectiles vs hitscan — decision
**Recommendation: short-lived fast projectiles (a "tracer" model), not pure
hitscan.** Rationale: (a) it reads correctly for a 16-bit machine gun — visible
tracer streams are part of the fantasy and the Art/Render area wants them; (b) it
gives drones a fair travel/lead window that makes `darter`/`zigzag` skill-based;
(c) it makes the aim-sway/drunk modifiers *feel* meaningful because bullets can
miss in flight. Projectiles are cheap: capped count, despawn off-screen or on hit.
Collision is **swept-segment vs circle** per tick (projectile previous→current
position against each drone's circle) so fast bullets never tunnel. A `hitscan`
fallback flag may exist for accessibility/perf but the default is projectiles.

## 5. Data / content tables

`src/content/drones.ts`:
```ts
export interface DroneDef {
  kind: string;
  baseHp: number;
  baseSpeed: number;       // px/s at D=0
  radius: number;
  escapeDamage: number;    // Post Integrity damage on escape
  awardsRuble: boolean;    // false for decoy_bird
  movement: 'straight' | 'zigzag' | 'kamikaze' | 'wander' | 'boss';
  unlockD: number;         // min difficulty before this kind appears
  weightAtD: (D: number) => number; // selection weight
}
```
`src/content/balance.ts`: spawn-interval, speed/hp scale constants, concurrent cap,
heat per shot, cool rate, jam-clear threshold, fire rate, turn rate.

## 6. Persistence
None directly. Run-summary stats this area produces (drones downed, drones escaped,
shots fired, accuracy) are handed to the Persistence/Highscores areas via the
final `gameOver` tally; this area does not write `localStorage`.

## 7. Dependencies & integration

- **Reads `GameState`:** `time.difficulty`, `time.phase` (visibility/feel),
  `meters` only via the `AimModifier` provided by the Meters area.
- **Writes `GameState`:** `combat.*`; increments `player.rubles` via the Economy-
  owned `grantRuble()` helper.
- **Emits:** `droneSpawned`, `shotFired`, `droneDestroyed`, `droneEscaped`,
  `rublesChanged`, `gameOver`.
- **Consumes (hooks called by others):** `setJam` (Incidents), `applySpawnOverride`
  (Incidents major-attack), `clearJam` service (Economy).
- **Injected ctx:** `rng`, `events`, `content`.

## 8. Required automated tests (MUST pass)

Per `architecture.md` §7, all tests must pass (`npm run check` green) before this
area is done. At minimum:

1. **Spawn determinism by seed:** same `(seed, D, dt sequence)` ⇒ identical
   `SpawnCommand[]` (kinds, positions, timing). Different seeds differ.
2. **Spawn scales with D:** higher `D` yields shorter average interval, higher
   concurrent cap, and a kind mix weighted toward harder drones (statistical
   assertion over a fixed seed).
3. **Collision hit vs miss:** swept projectile that crosses a drone circle
   registers a hit; one that passes outside the radius does not; fast bullet does
   not tunnel through a thin drone.
4. **Kill rewards & events:** destroying a ruble-awarding drone increments
   `player.rubles` by 1 and emits `droneDestroyed{byPlayer:true}` + `rublesChanged{+1}`.
5. **Decoy yields no ruble:** destroying `decoy_bird` emits `droneDestroyed` but
   grants no ruble.
6. **Escape damages Post Integrity:** a drone reaching its target emits
   `droneEscaped` and reduces `postIntegrity` by its `escapeDamage`.
7. **Post Integrity 0 ⇒ game over:** integrity hitting 0 emits exactly one
   `gameOver{cause:'post-destroyed'}` and halts spawning; never emitted twice.
8. **Drone HP/toughness:** a drone with hp N survives N−1 hits and dies on the Nth;
   `hpScale(D)` increases required hits at higher `D`.
9. **Fire-rate/cooldown enforcement:** holding fire produces shots at `fireRate`
   spacing given fixed `dt`; no shot before cooldown elapses.
10. **Overheat:** sustained fire reaches `heat=100`, locks firing, and resumes only
    after cooling below `cooloffResume`.
11. **Jam hook:** `setJam(true)` disables firing; clearing via accumulated
    `jamClearProgress` (or `clearJam`) re-enables it.
12. **Aim-modifier application:** `applyAimModifier` with a zeroed modifier returns
    the desired angle unchanged; with nonzero sway/drunkWobble it returns a
    deterministic offset for a given `(seed, t)`, and `steadinessPenalty` reduces
    effective turn rate.
13. **Keyboard aim parity:** the gun can be aimed and fired with keyboard-only
    input (no pointer) and produces equivalent firing behavior.

## 9. Acceptance criteria / Definition of done

- [ ] Global DoD (`architecture.md` §9) met: `tsc --noEmit`, ESLint, and `vitest
      run` all green; no `any` without justification; public API documented.
- [ ] `Playing` scene runs the full loop deterministically under a fixed seed.
- [ ] Drones spawn from all skyline edges, scale with `D`, and resolve via kill or
      escape.
- [ ] Gun supports pointer + keyboard aim, fire-rate, overheat, and the jam hook.
- [ ] Kills grant +1 ruble and emit the documented events; escapes damage Post
      Integrity; integrity 0 ends the run.
- [ ] Aim modifiers from Meters are applied to effective aim.
- [ ] All §8 tests authored and passing.

## 10. Open questions / risks

- **Aim feel vs accessibility:** turn-rate-limited aiming must remain fun on
  keyboard; may need an "assist" toggle (coordinate with Settings/HUD).
- **Boss drone** mechanics overlap with Incidents — agree the ownership boundary
  (Incidents triggers + scripts phases; engine simulates the entity).
- **Decoy penalty** value lives in Scoring; confirm the engine only flags the kind.
- **Performance:** projectile + drone counts at high `D` must stay within the
  concurrent caps; profile before raising caps.
