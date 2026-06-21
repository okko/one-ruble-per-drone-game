# Phase 2 Implementation Notes — Gameplay Logic

> Status: **Implementation record** for Phase 2 (areas 02 Meters, 03 Economy & Residents, 04 Scoring,
> 05 Random Incidents). Satisfies the per-area "public API + data tables documented" Definition of
> Done (`architecture.md §9`). Records the public surface, the content tables, and the cross-area
> integration decisions the area docs left open. All four areas are pure, deterministic, data-driven
> logic in `src/systems/` with their tables in `src/content/`; they integrate only via the typed
> event bus, the `GameState` slices, and the injected `SystemContext`.

## Public APIs (by area)

- **02 Meters** — `src/systems/meters.ts`: `createMetersState`, `update(m, dt, ctx, read: MetersRead)`,
  `computeEffects(m, balance) → MeterEffects`, `applyRelief(m, kind, ctx, opts?) → ReliefResult`,
  `applyRawRelief(m, meter, amount, ctx)`, `setDrunk`, `setCoffee`, `isCrisis`,
  `getAllMetersGreen(m, balance)`, `METER_INDICATORS`. Emits `meterCrisis`, `pooAccident`, `gameOver`.
  Table: `src/content/meters.ts` (`meterBalance`: rates, warn, modifiers, effect coefficients, relief
  magnitudes, tunables), validated by `meters-validate.ts`.
- **03 Economy** — `src/systems/economy.ts`: `createEconomyState(content)`, `bankIncome`,
  `handleDroneDestroyed`, `buyService`/`begFavor` (→ `Result<EconomyState>`), `updateEconomy`,
  `applyIncidentFlags`, `getAvailableInteractions`, `effectivePrice`, `netWorth`. Emits
  `rublesChanged`, `serviceBought`, `favorBegged`. Applies relief through the injected `ReliefSink`
  (`EconomyContext.applyRelief`). Table: `src/content/residents.ts` (`RESIDENTS`, `ECONOMY_TUNABLES`),
  validated by `residents-validate.ts`. **Relief bridge:** `src/systems/relief-bridge.ts`
  `createReliefSink(meters, ctx)` — the only module importing both Meters and Economy.
- **04 Scoring** — `src/systems/scoring.ts`: `createScoringState`, `updateScoring(state, dt, ctx)`,
  event handlers (`onDroneDestroyed`/`onDroneEscaped`/`onMeterCrisis`/`onIncidentStart`/
  `onIncidentEnd`/`onWaveStarted`), `registerScoring(state, ctx)`. Emits `scoreChanged`,
  `comboChanged` (single `addScore` path). Table: `src/content/scoring.ts`, validated by
  `scoring-validate.ts`.
- **05 Incidents** — `src/systems/incidents.ts`: `createIncidentsState(content)`,
  `updateIncidents(s, dt, ctx, D)`, `tryResolve(s, id, ctx)`, `DEFAULT_FLAGS`. Emits `incidentStart`,
  `incidentEnd {survived}`, `incidentPenalty`. Table: `src/content/incidents.ts` (`INCIDENTS` ×12,
  `schedulerTunables`), validated by `incidents-validate.ts`.
- **Assembly** — `src/state/create-game-state.ts` `createGameState(content, seed)`.

## Cross-area integration decisions

- **D1 — cross-slice reads via explicit params, not `ctx.state`.** `SystemContext` stays
  capability-only (`{rng, events, content}`). Meters reads `time`/`combat`/`incidents` data via a
  small `MetersRead` view the caller assembles; Scoring/Incidents/Economy take the slice/`D`
  explicitly. No import cycles.
- **D2 — slice interfaces in `state/game-state.ts`** (plus `IncidentFlags`/`ActiveIncident`/
  `MultiplierStep`/phase/category); behavioural types in the owning modules. `CombatState` left as
  area-01's placeholder. `ScoringState` gained `tidyFlushTimer`.
- **D3 — relief seam is request-authoritative.** Economy's roster authors raw `{meter, amount,
  secondary}` reliefs (its required test asserts the sink gets the exact request); timed side
  effects use a neutral `effect?: 'drunk' | 'coffee'` marker. The bridge applies the raw deltas
  (quality-scaled) + secondary (signed, unscaled) and routes the marker to Meters' `setDrunk`/
  `setCoffee`. Meters keeps its own kind-based `applyRelief` for direct callers + §8 tests.
- **D4 — content via `loadContent`.** Static tables are imported and validated at boot (loud
  failure). Tests use `src/test-support/` helpers; `src/systems/**` + `src/content/*` are in the
  vitest coverage `include` and stryker `mutate` sets so the gates measure the new logic.
- **D5 — events.** Additive, lead-approved bus changes: `incidentEnd` gained `survived`; added
  `pooAccident`, `incidentPenalty`, `waveStarted`, and an optional `droneDestroyed.colorTag`.
  Incident jitter computed inline as `-mean * Math.log(1 - rng.next())`. The Phase-1 determinism
  golden is unaffected (Core-only hash); Phase-2 determinism is guarded by per-area "same seed ⇒
  identical" tests (notably the incident scheduler).
- **D6 — other seams.** `getAllMetersGreen` is a one-way Scoring→Meters dependency. `economy.*` is
  the canonical money source (emits `rublesChanged`; the `player.*` projection is an Engine concern).
  Per-tick ordering contract: **Incidents → Meters/Economy → Scoring** (exercised in the `/tests`
  integration suite; the Engine owns the real loop). Chore/nap/gun-jam enactment is producer-side
  only here (the Engine enacts later).

## Deviations from the area-doc signatures (intentional, documented)

- Meters `update` takes a `MetersRead` 4th param (the docs' `ctx.state.*` pseudocode); `computeEffects`/
  `getAllMetersGreen` take the balance table rather than reading a global.
- A new poo-accident hook is a dedicated `pooAccident` event (not an overload of `meterCrisis`); its
  consumers (Scoring/Economy penalty + reputation reactions) are an open coordination item left for
  the Engine/HUD phase, per area 02 §10.
- The mechanic's gun-jam service/favor carry no meter relief (the Engine clears the jam on the
  `serviceBought`/favor signal); the oligarch "loan" is modelled as a meter relief on credit + a debt
  consequence (so the debt favor still grants a relief, per area 03 §8 test 5).
- `IncidentPhase` keeps the documented four-state contract, but the scheduler only produces
  `telegraph`/`active` and finalizes synchronously on expiry/resolution; `resolving`/`cleanup` are
  reserved for the contract / a future Engine wind-down window (independent-review nit, acknowledged).

## Independent review

An independent (non-author) review of the full Phase-2 diff returned **APPROVE-WITH-NITS**:
correctness matches the area docs across all four systems and both seams; no gate-gaming
anti-patterns (no `.only`/`.skip`, `as any`, `@ts-ignore`, mock-only tautologies; coverage `include`
and stryker `mutate` genuinely cover the new logic; thresholds unchanged); and the compliance
watch-items (Old Dmitri / vodka / the "drunk" marker; degraded-favor flavor) all punch up at the
regime / army-as-institution, never at people. The sole nit (the `IncidentPhase` states above) is
documented, not a behavior issue. Mutation score (advisory): ~74% across the new systems.

## Verification

`npm run check` (tsc + eslint + vitest with coverage ≥85/85/85 — Phase-2 logic well above) and
`npm run content-lint` are green; the `/tests` integration suite passes; `npm run test:mutation`
(advisory) covers the new systems. The Playwright cross-browser matrix remains a CI gate (Phase 2
added no render/input/scene code; `loadContent` still succeeds at boot with the new validated tables).
