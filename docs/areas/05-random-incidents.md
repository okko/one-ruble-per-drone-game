# Area: Random Incidents

**Owner:** <unassigned> · **Depends on:** Core Platform (RNG, events, content loader), Meters, Economy, Gameplay Engine · **Depended on by:** Gameplay Engine, Meters, Economy, Scoring, HUD, Audio, Render

> This is the area the brief singles out to be "designed in more detail by one area
> engineer." It is intentionally the most detailed area doc. Read
> `docs/game-design.md §7` and `docs/architecture.md` first.

## 1. Purpose

Owns the **random incident system**: a seeded scheduler that injects disruptive,
time-boxed events whose frequency and severity scale with difficulty `D`, plus the
full **incident catalog**. Incidents never reach into other systems directly —
they expose **flags and modifiers** on `IncidentsState` and emit `incidentStart` /
`incidentEnd` events; other areas *read* those flags and react. This keeps the grim
chaos (broken toilets, swarms, blackouts) decoupled and testable.

## 2. Scope

### In scope
- The incident **scheduler** (when the next incident fires; weighting by `D`;
  minimum spacing; overlap policy), driven by the injected seeded RNG.
- The incident **lifecycle** state machine: `telegraph → active → resolving →
  cleanup`, with timed expiry and/or player-action resolution.
- The **incident catalog** (data) — ~12 fully specified incidents.
- The `IncidentsState` slice and the **flags/modifiers** other areas consume.
- Emitting `incidentStart` / `incidentEnd`; awarding nothing directly (Scoring owns
  the survival bonus, triggered off `incidentEnd`).
- **Overlap composition** rules when two incidents are active at once.

### Out of scope (owned elsewhere)
- *Reacting* to flags: spawn spikes (Gameplay Engine), blocked 💩 relief (Meters),
  price multipliers / disabled services (Economy), screen darkening (Render),
  survival bonus (Scoring), alarms/ducking (Audio), telegraph banner (HUD). This
  area only *sets* the flags and emits the events.
- The difficulty value `D` itself (owned by Core/time; this area only reads it).

## 3. Requirements & mechanics

### 3.1 Scheduler
1. A countdown `nextIn` (seconds) to the next incident roll. When it hits 0, roll a
   weighted choice over the catalog (weights are functions of `D`) and start it.
2. **Frequency scales with `D`:** the base interval between incidents shrinks as `D`
   rises, clamped to a floor. Reference model (tunable in the balance table):
   `meanInterval = clamp(BASE_INTERVAL / (1 + D * RATE), MIN_INTERVAL, BASE_INTERVAL)`,
   then `nextIn = rng.expInterval(meanInterval)` (exponential jitter so timing is
   unpredictable but deterministic for a given seed).
3. **Minimum spacing / cooldown:** after any incident ends, enforce a global
   `postIncidentCooldown` before the next can *start*, and a per-incident `cooldown`
   so the same incident can't immediately repeat. The opening `GRACE_PERIOD` of a
   shift is incident-free so the player can settle.
4. **Eligibility filter:** an incident may roll only if its `minDifficulty ≤ D`, its
   per-incident cooldown has elapsed, and the overlap policy (3.3) permits it.
5. Determinism: all randomness uses the injected `Rng`. Same seed + same `D` history
   ⇒ identical incident sequence. No `Math.random()`, no real clock.

### 3.2 Lifecycle (per active incident)
`telegraph` → `active` → `resolving` → `cleanup` → removed.
1. **telegraph** (`telegraphSeconds`): emit `incidentStart`; HUD shows a cheerful
   warning banner, Audio plays an alarm. Flags are **not** applied yet (fair warning).
2. **active** (`durationSeconds`, or until a resolution condition is met): flags and
   modifiers are applied/visible on `IncidentsState`.
3. **resolving:** triggered either by timed expiry or by the player satisfying a
   `resolution` condition (e.g. paying a bribe, clearing a jam). Some incidents are
   purely timed; some are player-resolvable for a shorter duration / a bonus.
4. **cleanup:** clear all flags/modifiers this incident set, emit `incidentEnd`
   (with `survived: boolean` and `id`). Scoring listens and awards the survival bonus.
5. A `crisisOnExpiry` incident (rare) may apply a one-shot penalty if it expires
   unresolved (e.g. inspection: lose rubles).

### 3.3 Overlap policy
- Each incident declares a `category` (e.g. `plumbing`, `combat`, `power`,
  `service`, `social`, `authority`) and `exclusive` (bool).
- An `exclusive` incident blocks any new incident while active. Non-exclusive
  incidents may overlap **across categories** but never within the same category
  (no two `power` incidents at once).
- **Flag composition** when overlapping: boolean flags OR together (any active
  setter ⇒ true); numeric modifiers compose by the rule declared on the modifier
  (default **multiply** for price/spawn multipliers, **max** for severity-style
  values like darkness). Document each modifier's compose rule in the catalog.
- A hard cap `MAX_CONCURRENT` (default 2) prevents pile-ups regardless of category.

### 3.4 Telegraph & tone
Every incident has a cheerful name + grim flavor line (see catalog). Telegraphs must
be clearly readable and give enough lead time to react (min 2s). Keep the upbeat
game-show tone per GDD §2.

## 4. Public interface (TypeScript)

```ts
// src/state/game-state.ts (this area's slice)
export type IncidentPhase = 'telegraph' | 'active' | 'resolving' | 'cleanup';
export type IncidentCategory =
  | 'plumbing' | 'combat' | 'power' | 'service' | 'social' | 'authority' | 'nature';

export interface ActiveIncident {
  id: string;            // catalog id
  phase: IncidentPhase;
  phaseRemaining: number; // seconds left in current phase
  resolvable: boolean;
}

export interface IncidentsState {
  active: ActiveIncident[];
  nextIn: number;                 // seconds until next scheduler roll
  cooldowns: Record<string, number>; // per-incident cooldown remaining
  globalCooldown: number;
  // ---- READ-ONLY flags/modifiers other areas consume ----
  flags: IncidentFlags;
}

export interface IncidentFlags {
  toiletBlocked: boolean;        // Meters: block 💩 relief
  spawnRateMultiplier: number;   // Gameplay Engine: multiply drone spawn rate (default 1)
  bossActive: boolean;           // Gameplay Engine
  gunJammed: boolean;            // Gameplay Engine: barrel jam until cleared
  blackout: number;              // Render: 0..1 darkness (default 0)
  sleepGainMultiplier: number;   // Meters: multiply sleep-deprivation gain (default 1)
  servicePriceMultiplier: number;// Economy: multiply service prices (default 1)
  servicesDisabled: boolean;     // Economy: elevator broken → services unavailable
  inputLocked: boolean;          // Gameplay Engine/Input: ignore aim/fire input
  decoysActive: boolean;         // Gameplay Engine/Scoring: bird flock; shooting birds penalized
}

// src/systems/incidents.ts
export function updateIncidents(s: IncidentsState, dt: number, ctx: SystemContext, D: number): void;
export function tryResolve(s: IncidentsState, id: string, ctx: SystemContext): boolean; // player action
export const DEFAULT_FLAGS: Readonly<IncidentFlags>; // all-clear baseline used to recompute each tick
```

`updateIncidents` recomputes `flags` from `DEFAULT_FLAGS` + every active incident's
contribution each tick (so cleanup is automatic and composition is centralized).

### New events (extends `GameEvents`, architecture.md §5)
Already declared there: `incidentStart {id}`, `incidentEnd {id}`. This area adds the
`survived` field to the end payload via lead-approved extension:
```ts
incidentEnd: { id: string; survived: boolean };
```

## 5. Data / content tables

`src/content/incidents.ts` — the catalog (data, not logic):

```ts
export interface IncidentDef {
  id: string;
  name: string;            // cheerful
  flavor: string;          // grim
  category: IncidentCategory;
  exclusive: boolean;
  minDifficulty: number;   // D threshold
  weight: (D: number) => number; // relative roll weight
  telegraphSeconds: number;
  durationSeconds: number; // timed length (Infinity if only player-resolvable)
  cooldownSeconds: number; // per-incident reuse cooldown
  apply: (flags: IncidentFlags) => void;     // contribute to flags
  resolution?: ResolutionSpec;               // optional player resolution
  crisisOnExpiry?: (ctx: SystemContext) => void; // optional unresolved penalty
}
```

### Catalog (~12 incidents) — minimum set

| id | Name (cheerful) | Cat. | Effect (flags set) | Resolves by | Notes |
|---|---|---|---|---|---|
| `pipe_failure` | "Spa Day Downstairs!" | plumbing | `toiletBlocked=true` | timed | **Meters** can't relieve 💩 until end |
| `swarm` | "Welcome Committee!" | combat | `spawnRateMultiplier×=3` | timed | **Engine** spawn spike |
| `boss_drone` | "VIP Visitor!" | combat | `bossActive=true`, `spawnRateMultiplier×=1.5` | kill boss | **Engine** tough drone; resolvable |
| `blackout` | "Cozy Candlelight!" | power | `blackout=0.7`, `sleepGainMultiplier×=1.5` | timed | **Render** darken, **Meters** sleep |
| `gun_jam` | "Percussive Maintenance Time!" | power | `gunJammed=true` | clear jam (mash/action) | **Engine** jam; resolvable, shorter |
| `broken_elevator` | "Take the Stairs!" | service | `servicesDisabled=true` | timed | **Economy** no services |
| `resident_party` | "Neighbourly Festivities!" | social | `sleepGainMultiplier×=1.8` | timed | **Meters** sleep gain |
| `supply_shortage` | "Premium Pricing Event!" | service | `servicePriceMultiplier×=2` | timed | **Economy** prices spike |
| `propaganda` | "Mandatory Good News!" | authority | `inputLocked=true` (brief) | timed (short) | **Input/Engine** lock; keep ≤3s |
| `bird_flock` | "Feathered Friends!" | nature | `decoysActive=true` | timed | **Engine/Scoring** birds = penalty if shot |
| `inspection` | "Surprise Inspection!" | authority | none while active | pay bribe (rubles) | `crisisOnExpiry`: lose rubles/score if unpaid |
| `cold_snap` | "Bracing Fresh Air!" | nature | `sleepGainMultiplier×=1.3` + thirst hook | timed | mild, low-D filler |

Compose rules: all `*Multiplier` modifiers **multiply**; `blackout` composes by
**max**; booleans **OR**. Weights, durations, telegraph times, and bonus amounts
live in `src/content/incidents.ts` / the balance table and are tuned, not hard-coded
in `systems/`.

## 6. Persistence

None directly. (Incidents are part of the live run, which is not autosaved per
`docs/areas/09-state-and-persistence.md`.) The MetaStats repo may later count
"incidents survived" — if added, this area emits the data via `incidentEnd`; the
Persistence area owns the storage.

## 7. Dependencies & integration

**Reads:** injected `Rng`, `events` (ctx), `content.incidents`, current `D` (from
`time.difficulty`).
**Emits:** `incidentStart {id}`, `incidentEnd {id, survived}`.
**Flags consumed by:**
- Meters — `toiletBlocked`, `sleepGainMultiplier`.
- Gameplay Engine — `spawnRateMultiplier`, `bossActive`, `gunJammed`, `inputLocked`,
  `decoysActive`.
- Economy — `servicePriceMultiplier`, `servicesDisabled`.
- Render — `blackout`.
- Scoring — listens to `incidentEnd.survived` for the survival bonus; reads
  `decoysActive` to penalize bird hits.
- HUD — renders the telegraph banner from `incidentStart`/active list.
- Audio — alarm on `incidentStart`, music intensity on active set.

Integration rule (architecture.md §8): this area **only** mutates its own slice and
emits events. It never imports Meters/Economy/Engine modules.

## 8. Required automated tests (MUST pass)

All deterministic (seeded RNG, injected `dt`); `npm run check` green per
architecture.md §7. Minimum:

1. **Scheduler frequency scales with `D`:** mean inter-incident interval at high `D`
   is shorter than at low `D` over a fixed seed/sample; clamped at `MIN_INTERVAL`.
2. **Determinism:** same seed + same `D` history ⇒ identical incident id sequence
   and timings.
3. **Grace period:** no incident starts before `GRACE_PERIOD`.
4. **Minimum spacing:** `globalCooldown` enforced between incidents; per-incident
   `cooldownSeconds` prevents immediate repeat.
5. **Eligibility:** an incident with `minDifficulty > D` never rolls.
6. **Lifecycle transitions:** `telegraph → active → cleanup`; flags are NOT applied
   during telegraph and ARE applied during active.
7. **Flag set/clear:** each catalog incident sets exactly its declared flags while
   active and they return to `DEFAULT_FLAGS` after cleanup.
8. **Pipe failure ↔ Meters (integration):** while `pipe_failure` active,
   `toiletBlocked` is true and a 💩-relief attempt is rejected by Meters; after
   `incidentEnd`, relief works again.
9. **Survival bonus:** `incidentEnd` carries `survived:true` on timed completion and
   triggers Scoring's bonus (integration via event bus).
10. **Player resolution:** `tryResolve('gun_jam')` ends it early and clears
    `gunJammed`; `tryResolve` on a non-resolvable incident returns false.
11. **`crisisOnExpiry`:** `inspection` left unpaid applies its penalty exactly once
    on expiry; paid before expiry applies none.
12. **Overlap composition:** two overlapping multiplier incidents multiply
    (e.g. two price effects → ×4); same-category overlap is rejected; `MAX_CONCURRENT`
    cap respected; `blackout` composes by max.
13. **Input lock duration:** `propaganda` sets `inputLocked` for ≤ its short
    duration and clears it.

## 9. Acceptance criteria / Definition of done

- [ ] Scheduler, lifecycle, and overlap composition implemented per §3.
- [ ] Full catalog (≥12 incidents) implemented as data in `src/content/incidents.ts`
      with the literal cheerful/grim copy.
- [ ] `IncidentsState` + `IncidentFlags` match §4; flags recomputed each tick from a
      frozen `DEFAULT_FLAGS`.
- [ ] Only emits events + mutates own slice; no imports of other areas' systems.
- [ ] All §8 tests authored and passing; logic coverage ≥85%; `npm run check` green.
- [ ] Catalog copy reviewed for the cheerful-but-grim tone (GDD §2).

## 10. Open questions / risks

- **Difficulty coupling:** confirm whether a major incident should also *bump* `D`
  (GDD §4 allows incident-driven jumps). Proposed: `swarm`/`boss_drone` apply a
  small temporary `D` bump owned by Core/time, requested via an event.
- **Resolvable vs timed balance:** which incidents reward player action vs pure
  endurance — needs playtest tuning.
- **Fairness of `inputLocked`:** keep `propaganda` short and rare; never overlap it
  with a `swarm` (enforce via category/overlap rules or an explicit blocklist).
- **Accessibility:** `blackout` and flashing telegraphs need a reduced-flash setting
  (coordinate with Settings/Persistence).
