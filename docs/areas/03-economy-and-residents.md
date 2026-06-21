# Area: Economy & Residents

**Owner:** <unassigned> · **Depends on:** Core Platform, Meters (relief API), State & Persistence · **Depended on by:** HUD & In-game UI, Scoring, Random Incidents, Audio

## 1. Purpose

This area owns the in-game money economy and the building's residents. It tracks
**rubles**, **debt**, and **reputation**; converts destroyed drones into income;
and exposes the two ways the soldier meets his needs: **buying services** (when he
has money) and **begging favors** (when he is broke). It owns the resident roster
data, the service/favor catalogs, and the consequence model that makes favors hurt.
It produces the data the HUD/UI renders for the resident-interaction menu; it does
**not** render anything.

## 2. Scope

### In scope
- The `EconomyState` slice: rubles, debt, reputation, per-resident relationship.
- Income: converting `droneDestroyed` into `+1` ruble (or debt repayment).
- Resident roster as data (`src/content/residents.ts`): identity, services, favors.
- Buy-a-service flow: validate funds → deduct → apply meter relief → emit event.
- Beg-a-favor flow: grant effect → apply a consequence → emit event.
- The favor-consequence catalog (debt / chore / reputation / degraded outcome).
- The reputation model: how it gates and degrades favor availability/quality, and
  how it recovers.
- A **price multiplier** and **availability** hook so Random Incidents can spike
  prices (supply shortage) or disable services (broken elevator).
- A pure **availability query** that returns, for the current state, which services
  and favors are offerable right now (given rubles, reputation, incident flags) —
  consumed by the HUD/UI.

### Out of scope (owned elsewhere)
- Applying the actual meter changes — Economy **calls** the Meters relief API; the
  Meters area owns the math (this area only names the relief and magnitude).
- Rendering the interaction menu, input handling, toasts — HUD & In-game UI.
- Awarding score — Scoring listens to events; Economy does not touch score.
- Defining/triggering incidents — Random Incidents sets the flags Economy reads.
- The `+1 per drone` *kill detection* — Gameplay Engine emits `droneDestroyed`.

## 3. Requirements & mechanics

1. **Income (+1/drone).** Economy subscribes to `droneDestroyed` where
   `byPlayer === true`. Each such event yields **1 ruble** of gross income. Income
   is routed through `bankIncome()` (req. 3) so debt is repaid first.
2. **Debt-first banking.** The player may go into **negative spendable balance**
   only via favors (req. 6). Represent money as two non-negative fields:
   `rubles` (spendable, ≥ 0) and `debt` (owed, ≥ 0); they are never both > 0 at
   once. `bankIncome(n)`:
   - If `debt > 0`: pay down debt first — `paid = min(n, debt)`, `debt -= paid`,
     `n -= paid`. Any remainder increases `rubles`.
   - Else: `rubles += n`.
   - Always emit `rublesChanged { delta, total: rubles }` with the net change to
     spendable balance (0 if it all went to debt — still emit so HUD can flash the
     debt indicator). Net "worth" for display is `rubles - debt`.
3. **Spendable check.** `rubles` is the only thing you can spend. You cannot buy a
   service while `debt > 0` and `rubles === 0`. (You can buy once income has both
   cleared the debt and banked surplus.)
4. **Broke ⇒ favors.** "Broke" means `rubles === 0`. Begging a favor is only
   allowed while broke; buying a service is only allowed when `rubles >= price`.
   The UI uses the availability query (req. 11) to show the right options.
5. **Buy a service (have money).** See §4 `buyService`. Validate funds against the
   *effective* price (base × price multiplier, req. 9), deduct, apply the service's
   meter relief via the Meters relief API, adjust reputation slightly upward
   (paying customers are liked), emit `serviceBought`.
6. **Beg a favor (broke).** See §4 `begFavor`. Grant the favor's effect (usually a
   meter relief, possibly degraded), then apply exactly one **consequence** from the
   favor definition (req. 7), adjust reputation, emit
   `favorBegged { residentId, favor, consequence }`.
7. **Favor-consequence catalog.** Every favor names a consequence kind:
   - **`debt`** — `debt += amount`; future income repays it before banking (req. 2).
   - **`chore`** — schedules a time-boxed chore (`durationSeconds`) that pulls the
     player off the gun. Economy emits a `chore` request on the bus / sets
     `economy.activeChore`; the Gameplay Engine/HUD enacts the off-gun period.
     Economy only owns scheduling + clearing the chore timer.
   - **`reputation`** — `reputation -= amount` (the resident resents the moocher).
   - **`degraded`** — the granted relief is reduced and/or has a side effect
     (e.g. *expired stew*: relieves Hunger at 60% **and** adds +X to 💩). Encoded as
     a modified relief payload plus an optional secondary relief.
8. **Reputation model.** A single global `reputation` in `[0,100]` plus a per-
   resident `relationship` in `[0,100]` (starts at 60).
   - Buying raises that resident's relationship a little (+2) and global reputation
     a touch (+0.5).
   - Begging lowers them depending on the consequence (favors with `reputation`
     consequence hit hardest; `debt` favors are tolerated more).
   - **Gating:** a favor is offered only if `relationship >= favor.minRelationship`.
     Below a floor (`< 15`) a resident refuses all favors ("Not again, soldier.").
   - **Quality degradation:** when `relationship` is low, favor reliefs are scaled
     down (a `qualityFactor = clamp(relationship/60, 0.4, 1)` applied to relief
     magnitude). Generous when liked, stingy when not.
   - **Recovery:** relationship and reputation drift back toward a baseline (60 /
     50) slowly over time (`+rate * dt`), and jump on repayment of debt
     (clearing all debt grants a reputation bump).
9. **Pricing & incident hooks.** Economy reads incident flags from
   `IncidentsState` (or via `incidentStart/End` events it mirrors into its slice):
   - `priceMultiplier` (default 1.0) — **supply shortage** sets e.g. 2.0; effective
     price = `ceil(basePrice × priceMultiplier)`.
   - `servicesDisabled` flags (e.g. **broken elevator** disables delivery-type
     services; **pipe failure** disables `toilet`) — disabled services/favors are
     filtered out of availability (req. 11) and rejected by buy/beg.
10. **No double-charging / atomicity.** Buy/beg are pure transitions returning a new
    state (or a `Result`); never partially apply (deduct without relief, etc.). On
    failure return a typed error and change nothing.
11. **Availability query (for HUD/UI).** `getAvailableInteractions(state, content)`
    returns, per resident, the services and favors that are *currently offerable*,
    each annotated with effective price, affordability, disabled/refused reason, and
    a short flavor label. This is pure and side-effect-free so the UI can call it
    every frame.

## 4. Public interface (TypeScript)

```ts
// src/systems/economy/economy.ts
export type ResidentId = string;
export type MeterKey = 'sleep' | 'poo' | 'hunger' | 'thirst' | 'vice';

export interface EconomyState {
  rubles: number;                 // spendable, >= 0
  debt: number;                   // owed, >= 0 (rubles & debt never both > 0)
  reputation: number;             // global, 0..100
  relationships: Record<ResidentId, number>;  // per-resident, 0..100
  priceMultiplier: number;        // set by incidents (default 1.0)
  disabledServiceTags: string[];  // e.g. ['delivery'] (broken elevator), ['toilet'] (pipe)
  activeChore: { residentId: ResidentId; secondsLeft: number } | null;
}

// A relief request handed to the Meters area's relief API.
export interface ReliefRequest {
  meter: MeterKey;
  amount: number;                 // points to subtract from the meter (0..100)
  secondary?: { meter: MeterKey; amount: number };  // e.g. degraded food spikes 💩 (positive = worse)
}

export interface ServiceDef {
  id: string;
  label: string;                  // cheerful flavor: "Babushka's Famous Stew"
  basePrice: number;              // rubles
  tags: string[];                 // ['delivery'], ['toilet'], ['nap'], ['gun'] ...
  relief: ReliefRequest;
}

export type ConsequenceKind = 'debt' | 'chore' | 'reputation' | 'degraded';

export interface FavorDef {
  id: string;
  label: string;
  minRelationship: number;        // gate
  relief: ReliefRequest;          // base (pre-quality-factor) effect
  consequence:
    | { kind: 'debt'; amount: number }
    | { kind: 'chore'; durationSeconds: number }
    | { kind: 'reputation'; amount: number }
    | { kind: 'degraded'; reliefScale: number; sideEffect?: { meter: MeterKey; amount: number } };
}

export interface ResidentDef {
  id: ResidentId;
  name: string;
  floor: number;
  personality: string;            // flavor
  services: ServiceDef[];
  favors: FavorDef[];
}

export type EconomyError =
  | 'INSUFFICIENT_FUNDS'
  | 'NOT_BROKE'          // tried to beg while holding rubles
  | 'SERVICE_DISABLED'
  | 'FAVOR_REFUSED'      // relationship too low / gated
  | 'UNKNOWN';

export type Result<T> = { ok: true; value: T } | { ok: false; error: EconomyError };

// Income routing (subscribed to droneDestroyed).
export function bankIncome(state: EconomyState, amount: number, ctx: SystemContext): EconomyState;

// Transactions — pure, atomic. Both apply the relief via the injected meters API in ctx
// and emit the matching event; return the new EconomyState or an error.
export function buyService(
  state: EconomyState, residentId: ResidentId, serviceId: string, ctx: SystemContext
): Result<EconomyState>;

export function begFavor(
  state: EconomyState, residentId: ResidentId, favorId: string, ctx: SystemContext
): Result<EconomyState>;

// Per-frame update: chore countdown, reputation/relationship drift toward baseline.
export function updateEconomy(state: EconomyState, dt: number, ctx: SystemContext): EconomyState;

// Pure read model for the HUD/UI menu.
export interface InteractionOption {
  residentId: ResidentId;
  kind: 'service' | 'favor';
  id: string;
  label: string;
  effectivePrice: number | null;     // null for favors
  affordable: boolean;               // services only
  offerable: boolean;                // passes gating + not disabled
  reason?: 'INSUFFICIENT_FUNDS' | 'SERVICE_DISABLED' | 'FAVOR_REFUSED' | 'NOT_BROKE';
}
export function getAvailableInteractions(state: EconomyState, content: Content): InteractionOption[];

export function effectivePrice(state: EconomyState, svc: ServiceDef): number; // ceil(base * priceMultiplier)
export function netWorth(state: EconomyState): number; // rubles - debt (for display)
```

`SystemContext` (per architecture.md §4) carries `events`, `rng`, `content`, and —
for this area — an injected **meters relief sink** so `buyService`/`begFavor` apply
relief without importing the Meters module directly:

```ts
// added to SystemContext for this area's transactions
applyRelief: (req: ReliefRequest, qualityFactor?: number) => void;
```

## 5. Data / content tables

`src/content/residents.ts` exports `RESIDENTS: ResidentDef[]`. Starter roster
(cheerful-but-grim flavor; prices in rubles; reliefs reference 0–100 meters):

| id | name | floor | personality | signature services (price) | signature favors (consequence) |
|---|---|---|---|---|---|
| `babushka` | Galina Petrovna | 3 | warm, terrifying | Famous Stew −45 hunger (4₽); Strong Tea −20 thirst/−10 sleep (2₽) | "Leftovers" −27 hunger **degraded** (×0.6, +12 💩 — it's three days old) |
| `plumber` | Sergei the Plumber | 7 | gloomy realist | Toilet Access −60 💩 (3₽, tag `toilet`); Pipe Wisdom (pep) −8 sleep (1₽) | Bucket in the hall −40 💩 **reputation** (−10; the neighbors saw) |
| `oligarch` | Mr. Volkov | 22 (penthouse) | smug, generous-for-show | Imported Water −50 thirst (5₽); Cuban Cigar −60 vice (6₽); Nap Suite −70 sleep (8₽, tag `nap`) | Loan **debt** (+10₽ debt; "you'll pay me back, soldier") |
| `veteran` | Old Dmitri | 5 | grizzled; gentle with you, bitter at the army that used him up and discarded him | Vodka Shot −70 vice/−15 sleep, drunk debuff (3₽) — how he drowns what the army made him do; Pep Talk −12 sleep (1₽) — bitter solidarity ("they'll throw you away too, soldier") | Shared flask −50 vice **degraded** (×0.7, +6 sleep — mostly water; his army pension won't stretch to more) |
| `chef` | Café Below (Anya) | 1 | bubbly | Hot Pelmeni −55 hunger (5₽, tag `delivery`); Kvass −35 thirst (3₽, tag `delivery`) | Burnt scraps −25 hunger **chore** (12s — you fetch them yourself) |
| `mechanic` | Iron Lyuba | 9 | brusque | Clear Gun Jam (gun fix, tag `gun`) (4₽); Spare Cigarette −40 vice (2₽) | Jam-clear IOU **debt** (+6₽ debt) |
| `student` | Kostya upstairs | 14 | anxious insomniac | Energy Drink −30 sleep, vice +5 (3₽); Cigarette −40 vice (2₽) | Bummed smoke −25 vice **reputation** (−6) |
| `priest` | Father Pavel | 11 | serene, ominous | Confession (pep) −15 sleep (2₽); Blessed Water −45 thirst (3₽) | Charity meal −40 hunger **reputation** (−4, gentle) |

Notes:
- Tags drive incident gating: `delivery` services are disabled by **broken
  elevator**; `toilet` services/favors disabled by **pipe failure**.
- `nap` services hand the post to the resident for ~30s (Gameplay Engine handles the
  auto-defend window); modeled as a relief plus a flag.
- `gun` services clear a gun jam (Gameplay Engine reads the resulting flag/event).
- All numbers are starter values for the balance pass; tuned in playtest.
- **Old Dmitri (veteran) framing — compliance:** his drinking and bitterness are the
  result of how the army used and discarded him, never an ethnic trait. The vodka is
  coping; his pep talks are bitter solidarity with the fellow conscript. Keep his
  satire aimed at the military institution, not at Russian people (see
  `docs/compliance.md`). His dialog should make the army the target — e.g. "Twenty
  years I gave them. A ruble and a bad knee is what I got back."

A `validateResidents()` content-validator (unit-tested) asserts: unique ids, prices
≥ 1, reliefs reference valid meters and stay within 0–100, every favor has a valid
consequence, `minRelationship` in range.

## 6. Persistence

None directly. `EconomyState` is part of the in-run `GameState` and is not persisted
between runs. **Lifetime stats** that *are* persisted (e.g. total rubles earned all-
time) are owned by State & Persistence; Economy merely emits `rublesChanged` /
`serviceBought` / `favorBegged` which that area may aggregate.

## 7. Dependencies & integration

**Consumes (events):**
- `droneDestroyed { byPlayer }` → `bankIncome(+1)` when `byPlayer`.
- `incidentStart/incidentEnd { id }` → mirror into `priceMultiplier` /
  `disabledServiceTags` (supply shortage, broken elevator, pipe failure). Economy
  may instead read `IncidentsState` directly if that slice exposes these flags;
  prefer reading the slice and treat events as the trigger to re-derive.

**Emits (events):**
- `rublesChanged { delta, total }` — on any spendable-balance change (HUD, Audio
  cash-register SFX, Scoring listen if desired).
- `serviceBought { residentId, service, cost }`.
- `favorBegged { residentId, favor, consequence }`.

**Reads/writes slices:** owns/writes `state.economy`; mirrors `state.player.rubles/
debt/reputation` if the shared `player` slice is the canonical display source —
coordinate with the lead so there is ONE source of truth (recommendation: Economy
owns the numbers in `economy`, and `player.*` is a thin projection updated by
Economy). Calls `ctx.applyRelief` (Meters area) for all reliefs.

**Injected ctx:** `events`, `rng` (none needed currently but available), `content`
(`RESIDENTS`), `applyRelief`.

## 8. Required automated tests (MUST pass)

Per architecture.md §7 — deterministic (seeded RNG, injected `dt`), no wall clock,
mocked relief sink and event bus. **All of the following must pass; `npm run check`
must be green.**

Unit:
1. **Income banks +1.** A `droneDestroyed{byPlayer:true}` raises `rubles` by 1 and
   emits `rublesChanged{delta:1,total}`. `byPlayer:false` does nothing.
2. **Buy deducts & relieves.** `buyService` with sufficient funds reduces `rubles`
   by the effective price, calls `applyRelief` with the service's exact
   `ReliefRequest`, raises that resident's relationship, and emits `serviceBought`
   with the cost.
3. **Cannot buy without funds.** `buyService` with `rubles < effectivePrice` returns
   `{ok:false, error:'INSUFFICIENT_FUNDS'}`, changes nothing, emits nothing, calls
   no relief.
4. **Cannot buy while only in debt.** `rubles===0 && debt>0` → buy returns
   `INSUFFICIENT_FUNDS`.
5. **Favor grants effect + applies each consequence kind.** Parametrized over the
   four kinds:
   - `debt`: `begFavor` applies relief and sets `debt += amount`.
   - `chore`: sets `activeChore` with the right duration; relief applied.
   - `reputation`: lowers reputation/relationship by the stated amount.
   - `degraded`: relief magnitude scaled by `reliefScale`, and the `sideEffect`
     (e.g. +💩) applied as a secondary relief. All emit `favorBegged` with the
     correct `consequence` string.
6. **Favor only when broke.** `begFavor` while `rubles > 0` → `NOT_BROKE`, no change.
7. **Debt repaid before banking.** With `debt = 5`, three `droneDestroyed` events
   leave `debt = 2`, `rubles = 0`; five events leave `debt = 0`, `rubles = 0`; six
   leave `debt = 0`, `rubles = 1`. Clearing debt emits the reputation bump.
8. **Reputation gating.** A favor with `minRelationship = 40` is refused
   (`FAVOR_REFUSED`) when relationship `< 40`; offered otherwise. Relationship
   `< 15` refuses all favors.
9. **Reputation quality degradation.** Lower relationship scales favor relief down
   via `qualityFactor`; assert magnitude at relationship 60 (×1.0) vs 30 (×0.5).
10. **Reputation/relationship drift.** `updateEconomy` over time moves relationship
    toward baseline 60 and reputation toward 50 at the configured rate; buying
    raises, begging lowers, monotonic in the expected direction.
11. **Price multiplier.** With `priceMultiplier = 2`, `effectivePrice` doubles
    (rounded up) and the funds check uses it; supply-shortage incident sets it and
    `incidentEnd` resets it to 1.0.
12. **Disabled services.** With `disabledServiceTags` including `toilet`, buying or
    begging a `toilet` interaction returns `SERVICE_DISABLED` and it is excluded
    from availability; same for `delivery` under broken elevator.
13. **Atomicity.** A failed buy/beg leaves `EconomyState` byte-for-byte unchanged
    (deep-equal) and emits no events / calls no relief.
14. **Chore countdown.** `updateEconomy` decrements `activeChore.secondsLeft` and
    clears it (→ null) at zero.
15. **Content validator.** `validateResidents(RESIDENTS)` passes for the shipped
    roster; deliberately broken fixtures (dup id, price 0, bad meter, missing
    consequence, out-of-range relief) each fail with a clear error.

Integration:
16. **Availability reflects state.** `getAvailableInteractions` marks services
    `affordable` only when `rubles >= effectivePrice`, favors `offerable` only when
    broke **and** relationship-gated, and excludes interactions whose tag is in
    `disabledServiceTags`; reasons are correct.
17. **End-to-end income→spend.** Destroy 5 drones (5₽), buy a 4₽ service → relief
    applied, `rubles===1`, all expected events emitted in order.

## 9. Acceptance criteria / Definition of done

- [ ] `EconomyState` slice + all functions in §4 implemented, pure, atomic.
- [ ] Starter roster (§5) shipped and passing `validateResidents`.
- [ ] Income routes through debt-first banking; rubles never negative; debt & rubles
      never both > 0.
- [ ] Buy/beg flows validate, apply relief via `ctx.applyRelief`, emit correct
      events, and respect incident flags & reputation gating.
- [ ] Favor-consequence catalog (all four kinds) implemented.
- [ ] `getAvailableInteractions` gives the HUD everything it needs; Economy renders
      nothing.
- [ ] All §8 tests authored **and passing**; `tsc --noEmit`, ESLint, and `vitest run`
      green; logic coverage ≥ 85%.
- [ ] Public API + content tables documented in the area README section.

## 10. Open questions / risks

- **Single source of truth for money:** confirm with lead whether `player.rubles`
  or `economy.rubles` is canonical (recommendation above: `economy` owns, `player`
  projects).
- **Chore enactment boundary:** Economy schedules the chore; confirm exactly which
  area pulls the gun offline and how it signals completion back (event vs flag).
- **Nap service overlap** with the sleep meter and Gameplay Engine's auto-defend
  window — coordinate the 30s "resident covers the post" handoff.
- **Balance:** all prices/reliefs are first-pass; a dedicated tuning pass is needed
  so the broke→favor spiral is punishing but escapable.
- **Reputation curve shape** (linear drift vs eased) to be confirmed in playtest.
