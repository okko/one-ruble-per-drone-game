# Area: Gameplay Status (Need Meters)

**Owner:** <unassigned> · **Depends on:** Core Platform & Build · **Depended on by:** Gameplay Engine, HUD & In-game UI, Economy & Residents, Random Incidents, Scoring, Audio

## 1. Purpose

Owns the soldier's five "need" meters — the bodily-status simulation that drives
tension between defending the post and keeping the soldier functional. This area
models how meters drain over time, what debuffs they impose on the rest of the
game, how crises escalate to game over, and the relief API that the Economy &
Residents area calls when a need is satisfied. It exposes a single read-only debuff
struct that Gameplay Engine, HUD, and Render consume.

## 2. Scope

### In scope
- The `MetersState` slice and its pure `update(meters, dt, ctx)` function.
- The five meters, their drain model and per-meter modifiers.
- `warn` / `crisis` thresholds and per-meter debuff outputs.
- The computed, read-only `MeterEffects` struct consumed by other systems.
- Crisis lifecycle (entering/leaving crisis, grace timers) and the compound-crisis
  game-over rule.
- The relief API (`applyRelief`) and the distinct effects of vodka / cigarette /
  coffee / food / water / toilet.
- Emitting `meterCrisis` and `gameOver` events.

### Out of scope (owned elsewhere)
- How aim sway / movement slow / vision blur are *rendered or applied to physics* —
  this area only **publishes** the magnitudes; Gameplay Engine and Render consume
  them.
- The HUD bars and 💩 indicator drawing — owned by HUD & In-game UI (this area
  provides the values).
- Which resident provides which relief, pricing, and favor consequences — owned by
  Economy & Residents (it calls our relief API).
- Setting the pipe-failure flag — owned by Random Incidents (we only read it).
- Day/night phase scheduling — owned by Gameplay Engine / Core time (we read
  `time.phase`).

## 3. Requirements & mechanics

### 3.1 The five meters
All meters are `number` in `[0, 100]`, clamped. Convention: **0 = comfortable/safe,
100 = crisis**. Meters rise toward danger.

| Key | Indicator | Rises when… | Relieved by… |
|---|---|---|---|
| `sleep` | 😴 | always; faster at night | nap (resident covers post), coffee (temporary), vodka (partial) |
| `poo`   | 💩 (literal poo emoji in HUD) | always; faster after eating/drinking | toilet — **blocked during pipe-failure incident** |
| `hunger`| 🍞 | always | food |
| `thirst`| 💧 | always; faster during day & under heavy fire | water |
| `vice`  | 🚬 | always | cigarette (small) **or** vodka (large) |

> **Hard requirement:** the `poo` indicator must literally be the poo emoji `💩`.

### 3.2 Drain model
Each meter rises by `baseRate * modifier * dt` per tick (`dt` in seconds). Rates are
expressed in **points per second** and live in a balance table (`src/content/`), not
hard-coded. Proposed starting values:

| Meter | `baseRate` (pts/s) | Modifiers |
|---|---|---|
| `sleep`  | 0.45 | × `1.8` while `time.phase === 'night'`; × `1.5` while `viceCrisis` (jitter); − while coffee active (see relief) |
| `poo`    | 0.30 | + `pooKick` impulse on each food/water relief (one-shot bump, see relief) |
| `hunger` | 0.55 | (none baseline) |
| `thirst` | 0.50 | × `1.4` while `time.phase === 'day'`; + `0.6 * recentShotRate` (heavy fire) where `recentShotRate ∈ [0,1]` is supplied via ctx/combat read |
| `vice`   | 0.40 | (none baseline) |

Difficulty scaling: multiply **all** baseRates by `1 + 0.04 * time.difficulty` (small
global creep, tuned in balance table). `recentShotRate` is read from `combat` (a
normalized 0–1 EWMA of shots fired) — Gameplay Engine publishes it; if unavailable,
treat as 0.

Proposed update (pseudocode shape, real impl is pure & data-driven):

```ts
function update(m: MetersState, dt: number, ctx: SystemContext): void {
  const t = ctx.state.time;
  const diff = 1 + 0.04 * t.difficulty;

  // timed effects (coffee, drunk) decay first
  decayTimedEffects(m, dt);

  const rate = ctx.content.meterRates;
  const nightSleepMul = t.phase === 'night' ? 1.8 : 1.0;
  const viceJitterMul  = isCrisis(m, 'vice') ? 1.5 : 1.0;
  const coffeeOffset   = m.coffeeTimer > 0 ? rate.coffeeSleepRelief : 0; // pts/s reduction
  const dayThirstMul   = t.phase === 'day' ? 1.4 : 1.0;
  const fireThirst     = 0.6 * (ctx.state.combat?.recentShotRate ?? 0);

  add(m, 'sleep',  (rate.sleep  * nightSleepMul * viceJitterMul - coffeeOffset) * diff * dt);
  add(m, 'poo',     rate.poo  * diff * dt);
  add(m, 'hunger',  rate.hunger * diff * dt);
  add(m, 'thirst', (rate.thirst * dayThirstMul + fireThirst) * diff * dt);
  add(m, 'vice',    rate.vice * diff * dt);

  updateCrises(m, dt, ctx); // threshold transitions, grace timers, events, game-over
}
```

`add()` clamps to `[0,100]` and flips the per-meter `warn`/`crisis` edge flags used
by event emission.

### 3.3 Thresholds & debuff outputs
Each meter has `warn` and `crisis = 100` thresholds (warn values in balance table).
Proposed warn thresholds: `sleep 70, poo 75, hunger 70, thirst 70, vice 65`.

Above `warn`, each meter contributes to a computed, **read-only** `MeterEffects`
struct. Severity ramps linearly from `warn → 100` as `s = clamp01((v - warn) / (100 - warn))`.

| Meter | Effect above warn |
|---|---|
| `sleep`  | `microSleepChancePerSec += 0.20 * s`; `visionDim += 0.4 * s`; `aimSway += 0.3 * s` |
| `poo`    | `moveSlow += 0.5 * s`; `turnSlow += 0.5 * s` |
| `hunger` | `aimSway += 0.4 * s`; `interactSlow += 0.5 * s` (slow ruble/menu fumbling) |
| `thirst` | `visionBlur += 0.6 * s`; multiplies `sleep` & `hunger` gain by `1 + 0.5*s` (applied as a modifier in 3.2 if `thirst` over warn) |
| `vice`   | `aimSway += 0.5 * s` (jitter); contributes the `viceJitterMul` to sleep gain |

Plus the transient **drunk** debuff (set by vodka relief): `aimSway += drunkAmount`,
`aimDriftBias += drunkBias` while `drunkTimer > 0`.

`MeterEffects` shape (clamped/aggregated; consumers read, never write):

```ts
export interface MeterEffects {
  aimSway: number;              // 0..~2, added to gun jitter amplitude
  aimDriftBias: number;         // -1..1, steady drift (drunk)
  moveSlow: number;             // 0..1, fraction subtracted from move speed
  turnSlow: number;             // 0..1, fraction subtracted from turn speed
  interactSlow: number;         // 0..1, slows service/menu interactions
  visionDim: number;            // 0..1, darken overlay (sleep)
  visionBlur: number;           // 0..1, blur overlay (thirst)
  microSleepChancePerSec: number; // 0..1, prob/sec of a brief input dropout
  drunk: boolean;
}
export function computeEffects(m: MetersState): MeterEffects;
```

`microSleep` resolution itself (rolling the chance, locking input for ~0.4–0.8 s) is
performed by Gameplay Engine using our published `microSleepChancePerSec` and the
injected RNG, so it stays deterministic and testable.

### 3.4 Crisis lifecycle & game over
- When a meter reaches `100`, it **enters crisis**: set `crisisTimer[meter] = 0`,
  emit `meterCrisis { meter, entered: true }`. While in crisis, `crisisTimer`
  accumulates `dt`.
- When a meter in crisis is brought below `crisis - hysteresis` (proposed
  `hysteresis = 8`, i.e. back under 92) it **leaves crisis**: emit
  `meterCrisis { meter, entered: false }`, clear its timer.
- Per-meter "crisis spectacle" (one-shot side effects fired on *entry*, owned here):
  - `poo` → "accident": score penalty hook + reputation hit request (emit event;
    Scoring/Economy react) and a temporary `moveSlow`/`interactSlow` debuff.
  - others → telegraphed warning state (HUD/Audio react to `meterCrisis`).

**Compound-crisis / game-over rule (proposed, exact):**
- `GRACE_SECONDS = 12`.
- Track `activeCrises = count of meters currently in crisis`.
- **Game over** (emit `gameOver { score, cause }`, transition handled by state
  machine) when **either**:
  1. `activeCrises >= 2` **for a continuous `compoundGrace = 4` seconds**, OR
  2. any single meter's `crisisTimer >= GRACE_SECONDS`.
- `cause` strings: `"collapse:<meter>"` for the single-meter timeout, or
  `"compound:<meterA>+<meterB>"` (sorted keys) for the compound case.
- Rationale: a lone crisis is survivable but punishing if you fix it within 12 s;
  letting two stack is quickly lethal. Tunables (`GRACE_SECONDS`, `compoundGrace`,
  `hysteresis`) live in the balance table.

### 3.5 Relief API
Economy & Residents calls this when a service/favor delivers relief. Single entry
point keeps effects centralized and testable:

```ts
export type ReliefKind =
  | 'food' | 'water' | 'toilet' | 'cigarette' | 'vodka' | 'coffee' | 'nap';

export interface ReliefResult {
  applied: boolean;          // false if blocked (e.g. toilet during pipe failure)
  reason?: 'pipe_failure';   // why it was blocked
}

export function applyRelief(
  m: MetersState,
  kind: ReliefKind,
  ctx: SystemContext,
  opts?: { quality?: number } // 0..1, degraded favors pass <1 (Economy decides)
): ReliefResult;
```

Effects (magnitudes in balance table; `quality` scales the benefit and worsens side
effects — degraded favors pass `quality < 1`):

| Kind | Effect |
|---|---|
| `food`    | `hunger -= 60*q`; one-shot `poo += 12` kick (degraded food: bigger kick `+= 12 + 18*(1-q)`) |
| `water`   | `thirst -= 70*q`; one-shot `poo += 8` kick |
| `toilet`  | `poo -= 95*q` — **blocked** if `ctx.state.incidents.flags.pipeFailure` is set → returns `{applied:false, reason:'pipe_failure'}`, meter unchanged |
| `cigarette`| `vice -= 35*q` (small, clean) |
| `vodka`   | `vice -= 80*q`; `sleep -= 20*q` (soothes sleep); **sets drunk**: `drunkTimer = 18*q`, raising `aimSway`/`aimDriftBias` for the duration |
| `coffee`  | sets `coffeeTimer = 20`; applies the `coffeeSleepRelief` offset in 3.2 for the duration (temporary, not a flat cut) |
| `nap`     | `sleep -= 85*q` (resident covers the post; Gameplay Engine handles the "off the gun" window) |

Bringing a meter below `crisis - hysteresis` via relief triggers the leave-crisis
path in 3.4. Relief never pushes a meter below 0.

## 4. Public interface (TypeScript)

```ts
export type MeterKey = 'sleep' | 'poo' | 'hunger' | 'thirst' | 'vice';

export interface MetersState {
  values: Record<MeterKey, number>;     // 0..100
  inCrisis: Record<MeterKey, boolean>;
  crisisTimer: Record<MeterKey, number>; // seconds in crisis (0 if not)
  compoundTimer: number;                 // seconds with >=2 active crises
  coffeeTimer: number;                   // seconds remaining
  drunkTimer: number;                    // seconds remaining
}

export function createMetersState(): MetersState;          // all values 0, timers 0
export function update(m: MetersState, dt: number, ctx: SystemContext): void;
export function computeEffects(m: MetersState): MeterEffects;
export function applyRelief(m: MetersState, kind: ReliefKind, ctx: SystemContext, opts?: { quality?: number }): ReliefResult;
export function isCrisis(m: MetersState, k: MeterKey): boolean;
```

Indicator metadata for HUD (exported constant): `{ sleep:'😴', poo:'💩', hunger:'🍞', thirst:'💧', vice:'🚬' }`.

## 5. Data / content tables

Defines `src/content/meters.ts`:

```ts
export const meterRates = {
  sleep: 0.45, poo: 0.30, hunger: 0.55, thirst: 0.50, vice: 0.40,
  coffeeSleepRelief: 1.2, // pts/s subtracted while coffee active
};
export const meterWarn  = { sleep:70, poo:75, hunger:70, thirst:70, vice:65 };
export const meterTunables = {
  graceSeconds: 12, compoundGrace: 4, hysteresis: 8,
  diffCreepPerLevel: 0.04,
};
export const reliefTable = { /* per-kind amounts & side effects from §3.5 */ };
```

## 6. Persistence

None directly. End-of-run meter peaks / a "soiled yourself N times" stat may be
forwarded to the run summary, but writing to `localStorage` is owned by State &
Persistence (this area exposes the values).

## 7. Dependencies & integration

- **Reads from `ctx.state`:** `time.phase`, `time.difficulty`, `combat.recentShotRate`,
  `incidents.flags.pipeFailure`.
- **Injected ctx:** `rng` (for nothing required here — micro-sleep RNG lives in
  Gameplay Engine), `events`, `content`.
- **Emits:** `meterCrisis { meter, entered }`, `gameOver { score, cause }`, plus a
  `pooAccident { }` style hook on poo-crisis entry (final event name confirmed with
  Scoring/Economy).
- **Consumed by:** Gameplay Engine (effects → aim/move/microsleep), HUD & Render
  (effects + values), Audio (reacts to `meterCrisis`), Economy (calls `applyRelief`).

## 8. Required automated tests (MUST pass)

Per architecture.md §7, all tests must pass (`npm run check` green) before this area
is done. Deterministic via injected `dt` and seeded RNG; mock `events`/`content`.

1. **Drain — baseline:** after `update` with fixed `dt` over N ticks, each meter
   equals `baseRate * diff * elapsed` (within float epsilon), clamped at 100.
2. **Drain — night modifier:** `sleep` rises 1.8× faster when `time.phase==='night'`
   vs `'day'`.
3. **Drain — thirst modifiers:** `thirst` rises faster during `day`; rises further
   when `combat.recentShotRate` > 0; both compose.
4. **Drain — difficulty creep:** higher `time.difficulty` scales all rates by
   `1 + 0.04*difficulty`.
5. **Poo kick:** `food`/`water` relief adds the one-shot poo bump; degraded food
   (`quality<1`) adds a larger bump.
6. **Warn → effects:** `computeEffects` returns zeroed effects below all warns; above
   each warn the corresponding effect scales linearly with severity `s`; verify exact
   values at `v = warn`, midpoint, and `100`.
7. **Crisis entry emits event:** crossing 100 emits `meterCrisis{entered:true}`
   exactly once; staying ≥100 does not re-emit.
8. **Crisis exit hysteresis:** relief to between `92` and `100` does **not** leave
   crisis; below `92` emits `meterCrisis{entered:false}` once.
9. **Single-crisis game over:** one meter pinned at crisis for `>= graceSeconds`
   emits `gameOver{cause:"collapse:<meter>"}` exactly once.
10. **Compound game over:** two meters in crisis for `>= compoundGrace` emits
    `gameOver{cause:"compound:a+b"}` with sorted keys; a single crisis under grace
    does **not**.
11. **Relief correctness:** each `ReliefKind` reduces the correct meter by the
    table amount scaled by `quality`; never below 0.
12. **Vodka:** reduces `vice` (large) **and** `sleep`, sets `drunkTimer`>0, and
    `computeEffects().drunk===true` with raised `aimSway`/`aimDriftBias` until the
    timer expires.
13. **Cigarette:** small `vice` reduction, no drunk, no sleep change.
14. **Coffee:** sets `coffeeTimer`; sleep gain is reduced while active and returns to
    normal after expiry (temporary, not permanent).
15. **Toilet blocked by pipe failure:** with `incidents.flags.pipeFailure` set,
    `applyRelief('toilet')` returns `{applied:false, reason:'pipe_failure'}` and
    leaves `poo` unchanged; without the flag it reduces `poo`.
16. **Poo-accident spectacle:** poo crisis entry fires the accident hook/event and
    applies the temporary move/interact debuff.
17. **Effects struct aggregation:** with multiple meters above warn simultaneously,
    `aimSway`/`visionDim`/`visionBlur` aggregate as specified and stay clamped.

Target ≥85% line coverage for this area's logic.

## 9. Acceptance criteria / Definition of done

- [ ] `MetersState`, `update`, `computeEffects`, `applyRelief`, `isCrisis` implemented
      and typed per §4; no `any`.
- [ ] All five meters with the exact indicators; 💩 is the literal poo emoji.
- [ ] Drain model, thresholds, debuffs, crisis & compound rules match §3, all tunables
      in `src/content/meters.ts`.
- [ ] Relief API behaves per §3.5 including vodka/coffee/cigarette distinctions and
      pipe-failure blocking.
- [ ] Emits `meterCrisis` and `gameOver` per the event contract.
- [ ] All required tests authored and passing; `npm run check` green; ≥85% coverage.
- [ ] Pure logic only — no imports of render/audio/DOM; deterministic.

## 10. Open questions / risks

- Final event name for the poo-accident hook (coordinate with Scoring & Economy).
- Whether thirst's "multiplies sleep/hunger gain" is applied inside `update` (3.2) or
  surfaced via `MeterEffects` — proposal applies it in `update`; confirm with HUD if
  it needs to display the multiplier.
- `recentShotRate` contract with Gameplay Engine (EWMA window, 0–1 normalization).
- Balance of `graceSeconds`/`compoundGrace` vs game feel — expect tuning after the
  first playtest.
