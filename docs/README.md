# "One Ruble Per Drone" — Engineering Plan Index

> Working title. A bright 16-bit retro game with a grim, satirical premise: you man
> a machine-gun post atop a Moscow skyscraper, shoot down drones for **1 ruble each**,
> and fight your own body (sleep, 💩, hunger, thirst, the need to smoke or drink)
> while the building's residents sell you comfort — or extract favors when you're
> broke. Endless shift, pinball-style scoring, browser/TypeScript.

This folder is the complete implementation plan. Each area below is a self-contained
task an engineer can pick up cold. **Read the two foundation docs first**, then your
area doc.

## Foundation docs (read first)

| Doc | What it is |
|---|---|
| [`game-design.md`](game-design.md) | Game Design Document — premise, tone, the five need meters (incl. 💩), economy of services & favors, random incidents, pinball scoring, failure/game-over, persistence. |
| [`architecture.md`](architecture.md) | Tech stack (TypeScript + Vite + Canvas 2D + Vitest), project structure, the shared `GameState`/event-bus/scene contracts, the **testing strategy (all tests must pass)**, ownership rules, and the area-doc template every area below follows. |

## Area task docs

| # | Area | Doc | Owns |
|---|---|---|---|
| 00 | Core Platform & Build | [`areas/00-core-platform.md`](areas/00-core-platform.md) | Vite/TS scaffold, fixed-timestep loop, seedable RNG, event bus, registry, math, 384×216 scaler, input, SceneManager/GameState skeletons. |
| 01 | Gameplay Engine | [`areas/01-gameplay-engine.md`](areas/01-gameplay-engine.md) | `Playing` scene, drone spawning/AI, aiming + firing (overheat + jam hook), projectiles/collision, Post Integrity, game-over. |
| 02 | Gameplay Status (Meters) | [`areas/02-meters-and-status.md`](areas/02-meters-and-status.md) | The five need meters, drain model, warn/crisis + debuff effects, relief API, compound-crisis game-over. |
| 03 | Economy & Residents | [`areas/03-economy-and-residents.md`](areas/03-economy-and-residents.md) | Rubles/debt/reputation, resident roster, buy-service / beg-favor flows, favor-consequence catalog. |
| 04 | Scoring (Pinball) | [`areas/04-scoring.md`](areas/04-scoring.md) | Score (≠ rubles), combo/multiplier, jackpots, bonus modes, skill shots, tidy + incident-survival bonuses. |
| 05 | Random Incidents | [`areas/05-random-incidents.md`](areas/05-random-incidents.md) | Seeded incident scheduler + lifecycle + ~12-incident catalog, exposed as flags other areas read. **(Brief's emphasized area.)** |
| 06 | Audio (Music & SFX) | [`areas/06-audio.md`](areas/06-audio.md) | Injectable Web Audio backend, layered chiptune director, event→SFX bank, settings-driven volume/mute. |
| 07 | Main Menu | [`areas/07-main-menu.md`](areas/07-main-menu.md) | MainMenu scene, options + navigation + routing, title presentation, attract/idle mode. |
| 08 | Highscores | [`areas/08-highscores.md`](areas/08-highscores.md) | Highscore model, entry scene (retro initials), top-N list scene, qualification/sort logic (via Persistence repo). |
| 09 | State & Persistence | [`areas/09-state-and-persistence.md`](areas/09-state-and-persistence.md) | SceneManager implementation + legal transitions, localStorage wrapper (versioned, migrations, in-memory fallback), settings/highscores/meta repos. |
| 10 | HUD & In-game UI | [`areas/10-hud-ui.md`](areas/10-hud-ui.md) | In-game overlay (meter bars incl. literal 💩, ruble counter, pinball score/combo, post integrity), incident banner, resident interaction menu (view + intents). |
| 11 | Art & Visual Style | [`areas/11-art-visual-style.md`](areas/11-art-visual-style.md) | Palette, sprite specs, parallax skyline + day/night, font, animation, the asset-manifest contract + placeholder-art provider. |
| 12 | Credits View | [`areas/12-credits.md`](areas/12-credits.md) | Scrolling credits scene + the contributor roster (who participated, with what title). |

## Dependency & suggested build order

Everything depends on **Core (00)**; **Art (11)** ships placeholder art early so no
one is blocked on final pixels.

```
Phase 1 (foundation):      00 Core Platform   +   11 Art (placeholders)   +   09 State & Persistence
Phase 2 (gameplay logic):  02 Meters → 03 Economy, 04 Scoring, 05 Incidents   (parallel; share Core + events)
Phase 3 (the game):        01 Gameplay Engine   (consumes Meters/Incidents flags, emits combat/score events)
Phase 4 (presentation):    10 HUD/UI   +   06 Audio   (both react to GameState + events)
Phase 5 (shell):           07 Main Menu   +   08 Highscores   +   12 Credits   (need SceneManager + Persistence + Art)
```

Within a phase, areas can be built in parallel because they integrate only through
the shared contracts in `architecture.md` (§4 `GameState` slices, §5 event bus, §6
scenes) — never by importing each other's internals.

## Hard rules for every area (from `architecture.md`)

1. **Pure, deterministic logic.** No `Math.random()` (use the seeded RNG); no real
   clock in logic (time is injected as `dt`). This is what makes the game testable.
2. **Side effects at the edges.** Logic must not import rendering/audio/DOM/storage.
3. **Integrate via contracts only** — the `GameState` slice your area owns and the
   typed event bus. Don't reach into another area's modules.
4. **Data-driven content** lives in `src/content/`, not buried in system code.
5. **Tests are mandatory and must pass.** Each area doc lists its required automated
   tests as a *minimum*. An area is not done until `npm run check`
   (`tsc --noEmit && eslint . && vitest run`) is green and logic coverage ≥ 85%.

## Definition of done (per area)

See `architecture.md §9`. In short: matches the GDD + its area doc, honors the shared
contracts, required tests authored **and passing**, clean lint/types, and a short
public-API note. Tone check: keep all player-facing copy relentlessly cheerful over
the grim subject matter (GDD §2).
