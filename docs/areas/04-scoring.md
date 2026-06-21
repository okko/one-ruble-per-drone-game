# Area: Scoring (Pinball)

**Owner:** <unassigned> · **Depends on:** Core Platform, Gameplay Engine, Meters, Random Incidents · **Depended on by:** HUD, Highscores

## 1. Purpose

Own the **score** — the pinball-style points total that is the game's highscore
metric. Score is **separate from rubles** (rubles are the in-game economy; +1/drone
and spent on residents). This area turns gameplay events (drones destroyed, misses,
meter crises, incidents survived, self-care) into points via base values,
multipliers, combos, jackpots, bonus modes, skill shots, and a tidy bonus. All point
values are data-driven; this area emits `scoreChanged` and `comboChanged`.

## 2. Scope

### In scope
- The `ScoringState` slice and its update reducer.
- Combo / multiplier logic (gain, decay, reset).
- Jackpot "lit sequence" detection and awards.
- Bonus-mode (frenzy / multiball-style) trigger, ×N application, and timeout.
- Skill-shot window detection.
- Tidy bonus (point trickle while all meters green).
- Incident survival bonus.
- The score balance table in `src/content/scoring.ts`.
- Emitting `scoreChanged` and `comboChanged`.

### Out of scope (owned elsewhere)
- Rubles / debt / reputation (Economy & Residents).
- Drone destruction detection and drone types (Gameplay Engine — we consume
  `droneDestroyed` / `droneEscaped` / `shotFired`).
- Meter values and crisis detection (Meters — we consume `meterCrisis` and read the
  meters slice for the tidy bonus).
- Incident lifecycle (Random Incidents — we consume `incidentStart`/`incidentEnd`).
- Rendering the score / combo (HUD).
- Persisting the final score (Highscores / Persistence).

## 3. Requirements & mechanics

### 3.1 Base points per drone
1. Each drone destroyed by the player awards **base points** looked up by drone
   `kind` from the balance table, then multiplied by the current multiplier:
   `awarded = round(basePoints[kind] * multiplier * bonusModeFactor)`.
2. Drones that escape (`droneEscaped`) award **no** points and count as a **miss**
   for combo purposes (§3.2). Player-fired shots that hit nothing are *not* by
   themselves misses — only an escaped drone or an expired drone breaks the combo
   (a "miss" = letting a drone through). This keeps spray-fire from nuking combos
   while still punishing failed defense. (Confirm with Gameplay Engine which event
   signals a "missed/expired" drone; default: `droneEscaped`.)

### 3.2 Combo & multiplier
1. **Combo count** increments by 1 on each `droneDestroyed{byPlayer:true}`.
2. **Multiplier** is a stepped function of combo count, from the balance table, e.g.
   `comboThresholds = [0→×1, 5→×2, 12→×3, 22→×4, 35→×5]` (cap ×5). Crossing a
   threshold emits `comboChanged{multiplier}`.
3. On a **miss** (`droneEscaped`): combo resets to 0 and multiplier drops by one
   step (soft decay) — *not* all the way to ×1 unless already at the bottom step.
   Configurable: `missResetMode: 'step' | 'full'` (default `'step'`).
4. On **`meterCrisis{entered:true}`** (any meter): multiplier resets to ×1 and combo
   resets to 0 immediately (hard reset). Emit `comboChanged`.
5. A grace **combo-decay timer** optionally lowers combo if no kill occurs for `T`
   seconds (table value, default disabled `T=Infinity`); keep it data-driven so
   balance can enable it later.

### 3.3 Jackpots (lit sequences)
1. Certain drones carry a `colorTag` (e.g. `R`, `U`, `B`, `L`, `E`). Destroying them
   **in order** lights letters spelling a target word — default sequence
   **`R-U-B-L-E`**.
2. State tracks `litSequence` (letters lit so far). A correct next letter advances
   it; the wrong colored special drone resets `litSequence` to empty (normal drones
   don't affect it).
3. Completing the sequence awards a **jackpot** lump (table value, scaled by
   multiplier), emits `scoreChanged{reason:'jackpot'}`, then resets `litSequence`.
   Repeated completions may escalate (`jackpotValue * completionCount`, capped).
4. The set of words/sequences is data-driven so designers can add seasonal words.

### 3.4 Bonus modes (frenzy / multiball-style)
1. A bonus mode applies a global `bonusModeFactor` (×N, table value e.g. ×5) to all
   drone points for its duration.
2. Triggers (data-driven list): completing a jackpot may start a short frenzy;
   surviving a major-drone-attack incident may grant one; or a dedicated "frenzy
   drone" kind starts it on destruction.
3. A bonus mode has a duration (table value, e.g. 8 s) tracked in state and counted
   down with `dt`. On expiry it ends and `bonusModeFactor` returns to 1. Multiple
   triggers refresh/extend rather than stack beyond a cap (`maxBonusFactor`).

### 3.5 Skill shots
1. When a new wave begins (signal TBD with Gameplay Engine; default: first
   `droneSpawned` after a quiet gap, or an explicit `waveStarted` event), open a
   **skill-shot window** of `W` seconds (table value, default 1.5 s).
2. Destroying the first drone within the window awards a skill-shot bonus
   (`scoreChanged{reason:'skillshot'}`). The window then closes until the next wave.

### 3.6 Tidy bonus
1. While **all** meters are in the green (each below its `warn` threshold — read the
   Meters slice / `getAllMetersGreen()`), accrue points at `tidyRate` points/second
   into a trickle accumulator; flush whole points to the score (emit
   `scoreChanged{reason:'tidy'}` at most ~1/second to avoid event spam).
2. The instant any meter leaves the green, the trickle stops (rate → 0). It resumes
   when all meters return to green. The accumulator's fractional remainder persists.

### 3.7 Incident survival bonus
1. On `incidentStart{id}`, record the active incident id.
2. On `incidentEnd{id}`, if the player was not in a game-over state, award a survival
   lump (table value, possibly per-incident-id) and emit
   `scoreChanged{reason:'incident-survived'}`. Clear the recorded id.

### 3.8 Score change emission
- Every score mutation goes through a single internal `addScore(delta, reason)` that
  updates `state.scoring.score` and emits `scoreChanged{delta, total, reason}`.
- Reasons (string enum): `'drone' | 'jackpot' | 'frenzy' | 'skillshot' | 'tidy' |
  'incident-survived'`.
- Never mutate `score` directly outside `addScore`.

## 4. Public interface (TypeScript)

```ts
// src/state/game-state.ts (this area's slice)
export type MultiplierStep = 1 | 2 | 3 | 4 | 5;

export interface ScoringState {
  score: number;                 // the highscore metric
  comboCount: number;            // consecutive player kills without a miss
  multiplier: MultiplierStep;    // derived from comboCount via table
  comboDecayTimer: number;       // seconds since last kill (for optional decay)
  litSequence: string[];         // jackpot letters lit so far, e.g. ['R','U']
  jackpotCompletions: number;    // for escalating jackpots
  bonusModeFactor: number;       // 1 normally, N during frenzy
  bonusModeTimer: number;        // seconds remaining of current bonus mode
  skillShotWindow: number;       // seconds remaining in open window, 0 if closed
  tidyAccumulator: number;       // fractional tidy points pending flush
  activeIncidentId: string | null;
}

// src/systems/scoring.ts
export function createScoringState(): ScoringState;
export function updateScoring(state: GameState, dt: number, ctx: SystemContext): void;
// updateScoring: counts down timers, accrues tidy bonus, flushes accumulator.
// Event handlers (registered on ctx.events) drive the discrete awards/resets.
```

## 5. Data / content tables

```ts
// src/content/scoring.ts
export interface ScoringBalance {
  basePoints: Record<string, number>;        // drone kind -> base points
  comboThresholds: Array<{ combo: number; mult: MultiplierStep }>;
  missResetMode: 'step' | 'full';
  comboDecaySeconds: number;                  // Infinity to disable
  jackpotSequences: Array<{ word: string; baseValue: number; escalates: boolean; maxMult: number }>;
  bonusMode: { factor: number; durationSeconds: number; maxFactor: number };
  skillShot: { windowSeconds: number; bonus: number };
  tidyRatePerSecond: number;
  incidentSurvivalBonus: Record<string, number> & { default: number };
}
```

Example rows: `basePoints = { scout: 100, heavy: 300, kamikaze: 250, frenzy: 50,
boss: 2000 }`; `jackpotSequences = [{ word:'RUBLE', baseValue:5000, escalates:true,
maxMult:5 }]`; `bonusMode = { factor:5, durationSeconds:8, maxFactor:5 }`.

## 6. Persistence

None directly. The final `score` is read by the Highscores area at game over; this
area does not write to `localStorage`.

## 7. Dependencies & integration

- **Consumes events:** `droneDestroyed`, `droneEscaped` (and/or wave/expiry signal),
  `meterCrisis`, `incidentStart`, `incidentEnd`, and a wave-start signal for skill
  shots (coordinate exact event with Gameplay Engine).
- **Emits events:** `scoreChanged`, `comboChanged`.
- **Reads slices:** `meters` (for the tidy-bonus all-green check). Reads
  `combat`/drone `kind` via the `droneDestroyed` payload.
- **Uses ctx:** `events` for pub/sub, `content` for the balance table. No RNG needed
  unless randomized jackpot values are added (then use `ctx.rng`).

## 8. Required automated tests (MUST pass)

All tests deterministic (seeded RNG, injected `dt`); `npm run check` green per
architecture.md §7.

1. **Combo increments** on consecutive `droneDestroyed{byPlayer:true}`.
2. **Combo resets on miss** — `droneEscaped` resets combo to 0 and steps multiplier
   down (and full-reset when `missResetMode:'full'`).
3. **Multiplier applied** — points awarded = `basePoints[kind] * multiplier`
   (verify across thresholds; verify `comboChanged` fires on threshold crossings).
4. **meterCrisis resets multiplier** — `meterCrisis{entered:true}` hard-resets combo
   and multiplier to ×1 and emits `comboChanged`.
5. **Jackpot sequence** — feeding colored drones in order lights letters; a wrong
   colored special resets `litSequence`; completing the word awards the jackpot
   (scaled), emits `scoreChanged{reason:'jackpot'}`, and resets the sequence;
   escalation increments on repeat.
6. **Bonus mode** — trigger starts the mode; kills during it score ×N; the mode
   times out after `durationSeconds` of `dt` and ×N reverts to 1; re-trigger
   refreshes without exceeding `maxFactor`.
7. **Skill-shot window timing** — first kill within `windowSeconds` awards the bonus;
   a kill after the window does not; window closes after award.
8. **Tidy bonus** — accrues only while all meters green; verify it stops the tick a
   meter leaves green and resumes when all return; verify accumulator flush emits
   `scoreChanged{reason:'tidy'}` at the throttled cadence.
9. **Incident survival bonus** — `incidentEnd` after a matching `incidentStart`
   awards the lump (per-id value, else default) and emits
   `scoreChanged{reason:'incident-survived'}`.
10. **Event emission discipline** — every score mutation emits exactly one
    `scoreChanged` with the correct `delta`, `total`, and `reason`; no direct score
    mutation bypasses `addScore`.

Target ≥ 85% line coverage for `systems/scoring.ts` and the balance validator.

## 9. Acceptance criteria / Definition of done

- [ ] `ScoringState` slice + reducer implemented to the contract above.
- [ ] All point values sourced from `src/content/scoring.ts`; none hard-coded in
      logic.
- [ ] Score is fully decoupled from rubles (no reads/writes of `player.rubles`).
- [ ] Combo, jackpot, bonus-mode, skill-shot, tidy, and incident-survival mechanics
      all behave per §3.
- [ ] `scoreChanged` / `comboChanged` emitted correctly; HUD and Highscores can rely
      on them.
- [ ] All required tests authored and passing; `npm run check` green.
- [ ] Public API documented per architecture.md §9.

## 10. Open questions / risks

- Exact "miss" signal for combo breaks — `droneEscaped` only, or also an
  off-screen/expiry event? Resolve with Gameplay Engine.
- Wave-start signal for skill shots — does Gameplay Engine emit `waveStarted`, or do
  we infer waves from spawn gaps? Prefer an explicit event.
- Balance risk: multiplier + bonus mode + jackpot escalation could compound into
  runaway scores; cap via `maxFactor`/`maxMult` and playtest.
- Tidy-bonus event throttling must not starve very-short green windows of credit;
  flush remainder on meter-leaves-green.
