# Game Design Document — "One Ruble Per Drone" (working title)

> Status: **Foundation doc (authored by lead).** Read this first. Every area task
> in `docs/areas/` builds on the design described here. If an area task and this
> document disagree, raise it with the lead before coding.

## 1. Logline

You are a conscripted soldier manning a single machine-gun post on the roof of a
Moscow skyscraper. Drones may appear at any time, from any direction. You shoot
them down for **1 ruble each**. Meanwhile your body betrays you — you grow tired,
hungry, thirsty, desperate for the toilet, and desperate for a smoke or a swig of
vodka. When you have rubles you can buy comfort from the building's residents.
When you are broke you must beg them for favors, and favors are never free.

How long can you last, and how high can you score?

## 2. Tone & aesthetic

- **Visuals:** bright, cheerful 16-bit SNES-era pixel art. Saturated palette, sunny
  Moscow skyline, onion domes glinting, friendly chunky sprites.
- **Audio:** bouncy, upbeat chiptune.
- **Subtext:** the plot is grim and satirical. The contrast between the cheerful
  presentation and the bleak premise *is* the game's identity. Keep the surface
  relentlessly upbeat; let the darkness live in the writing, the economy, and the
  consequences. Never break the cheerful tone in UI copy — a "you soiled yourself"
  event should be announced like a game-show prize.

This is satire. Keep it absurd and human, not gratuitous.

## 3. Core gameplay loop

1. **Defend.** Drones spawn from the skyline at any angle and time. Aim the gun and
   fire. A destroyed drone pays **+1 ruble** and awards **points** (see scoring).
2. **Survive your body.** Five need meters drain continuously (§5). Let one hit
   crisis and you suffer escalating penalties.
3. **Spend or beg.** Satisfy needs by either **buying services** from residents
   (costs rubles, clean outcome) or, when broke, **begging favors** (free up front,
   but each favor inflicts a consequence — debt, a chore, reputation loss, or a
   degraded outcome). See §6.
4. **Endure escalation.** The longer the shift runs, the more (and nastier) the
   drones, and the more frequent the random incidents (§7).
5. **Chase the score.** Scoring is pinball-style (§8): combos, multipliers,
   jackpots, bonus modes. Survival feeds the score; the run ends at game over and
   you enter the highscore table.

There is no "win." The game is an endless shift; the goal is a high score.

## 4. The shift: difficulty & time

- The run is framed as a **shift** measured in in-game minutes (compressed real
  time). A day/night cycle loops (e.g. a full cycle every few minutes of real
  play).
- A single scalar **difficulty level `D`** rises monotonically with elapsed shift
  time (and jumps during certain incidents). `D` drives: drone spawn rate, drone
  speed, drone toughness, the mix of drone types, and incident frequency.
- **Night** phases raise sleep-deprivation gain and reduce visibility; **day**
  phases are easier to see but hotter (faster thirst). The day/night cycle is a
  visual + balance lever owned jointly by the gameplay-engine and meters areas.
- Difficulty must ramp smoothly, not in cliffs, with occasional brief "lulls" so
  the player can attend to needs. Exact curves are tuned in balance tables
  (`src/content/`), not hard-coded.

## 5. The need meters ("gameplay status")

All meters are normalized **0–100**. By convention **0 = comfortable / safe** and
**100 = crisis**, i.e. meters *rise* toward danger. Each meter has a `warn`
threshold (debuffs begin) and a `crisis` threshold of 100 (a crisis event fires).

| Meter | Indicator | Rises when… | Relieved by… | When critical… |
|---|---|---|---|---|
| **Sleep deprivation** | 😴 | always; faster at night | nap service (resident covers the post), coffee (temporary) | screen dims, aim sway, brief "micro-sleep" input dropouts |
| **Poo** | 💩 | always; faster after eating/drinking | toilet (resident's bathroom) — **blocked during a pipe incident** | movement/turn speed drops; at 100 → "accident" crisis (big score & reputation hit, temporary debuff) |
| **Hunger** | 🍞 | always | food service | aim sway, slow ruble fumbling |
| **Thirst** | 💧 | always; faster during day / under heavy fire | water service | faster sleep & hunger gain, blurry vision |
| **Vice (smoke *or* vodka)** | 🚬 | always | **either** a cigarette **or** vodka | jitter (aim sway, faster sleep gain) |

Notes:

- **Vice is one meter with two satisfiers.** A cigarette gives a small, clean
  reduction. **Vodka** gives a large reduction *and* soothes sleep deprivation, but
  temporarily impairs aim (drunk) — risk/reward. This is the "smoke or get drunk"
  need from the brief.
- The 💩 indicator **must literally be the poo emoji** in the HUD.
- **Crisis behavior:** when a meter reaches 100 it enters a crisis with a grace
  timer. Resolving the need clears it. If a meter stays in crisis past its grace
  timer, or if **two or more meters are simultaneously in crisis**, the run trends
  toward game over (the meters area defines exact rules; the lead's intent is:
  single short crises are survivable and punishing; compound crises are lethal).

## 6. Economy: rubles, services, and favors

- **Rubles** are the in-game currency. You earn **+1 per drone destroyed**. They are
  spent on services. Rubles are **not** the score (§8) — keep them mentally and
  mechanically distinct.
- The skyscraper is populated by **residents** (characters on different floors),
  each with personality, a set of **services** (priced in rubles) and **favors**
  (granted when you are broke). Examples of services: food delivery, water, a
  cigarette, a vodka shot, toilet access, a 30-second nap (resident covers the
  post), gun-jam clearing, a morale pep talk.
- **When you have money → buy a service.** Fast, reliable, clean outcome.
- **When you are broke (0 rubles) → beg a favor.** The resident helps, but every
  favor carries a **consequence**, e.g.:
  - **Debt:** you go into negative rubles; future drone kills repay the debt before
    you bank anything.
  - **Chore:** a small time-boxed task / mini-distraction that pulls you off the gun.
  - **Reputation loss:** residents grow less generous; future favors get worse or
    are refused.
  - **Degraded outcome:** expired food (relieves hunger but spikes 💩), watered-down
    vodka, a cigarette butt, a nap that's interrupted.
- Residents and their service/favor tables are **data-driven** (`src/content/`).
  The full character roster, pricing, reputation model, and favor-consequence
  catalog are designed in the **Economy & Residents** area.

## 7. Random incidents

Disruptive timed events that escalate in frequency with `D`. They are a first-class
system with its own catalog and scheduler, designed in the **Random Incidents**
area. Seed ideas (the area engineer expands and balances these):

- **Pipe failure** — toilets unavailable; 💩 cannot be relieved until fixed.
- **Major drone attack** — a swarm or a tough "boss" drone; spawn rate spikes.
- **Electrical issues** — night blackout (low visibility), HUD flicker, or gun
  jams that must be cleared.
- **Broken elevator** — services arrive slowly or are temporarily unavailable.
- **Resident party** — noise raises sleep-deprivation gain.
- **Supply shortage** — service prices spike.
- **Propaganda broadcast** — a forced interruption that briefly locks input.
- **Bird flock / decoys** — non-drone targets; shooting them is penalized.
- **Surprise inspection / bribe** — pay rubles or suffer a penalty.

Incidents should overlap with the cheerful tone (cheerful announcement, grim
content), telegraph clearly, and reward the player for surviving them (score bonus).

## 8. Scoring (pinball-style)

The **score** is the highscore metric and is separate from rubles. It behaves like
a pinball machine:

- **Base points** per destroyed drone, varying by drone type.
- **Multiplier** that climbs with a **combo** (consecutive hits without a miss) and
  **decays/resets** on a miss or when a meter enters crisis.
- **Jackpots:** light up sequences (e.g. destroy a run of colored "special" drones
  to spell a word) for large one-off awards.
- **Bonus modes:** temporary frenzies (e.g. a "multiball"-style wave where every
  kill scores ×N).
- **Skill shots:** e.g. destroy the first drone of a wave within a tight window.
- **Tidy bonus:** a slow point trickle while *all* meters are in the green —
  rewarding self-care.
- **Incident survival bonus:** lump sum for surviving an incident.

Design goal: reward aggressive, clean play *and* good self-management, and make the
score swing dramatically so the highscore chase is exciting. Exact values live in
balance tables and are owned by the **Scoring** area.

## 9. Failure & game over

- **Need crisis:** sustained single-meter crisis or compound (2+) crises → game
  over (rules owned by Meters area).
- **Post integrity:** drones you fail to destroy reach the building and damage the
  **Post Integrity** meter; at 0 → game over (owned by Gameplay Engine area).
- On game over: tally final score, show a cheerful-but-bleak summary, and route to
  **highscore entry** if the score qualifies.

## 10. Persistence (browser local storage)

Stored in `localStorage` (schema + versioning owned by Persistence area):

- **Highscores:** top-N entries (initials/name, score, shift length, date, notable
  stats).
- **Settings:** master/music/sfx volume, mute, key/aim bindings, accessibility
  toggles.
- **Meta:** best shift length, total drones downed across all runs, last-run
  summary, a "seen the intro" flag.

## 11. Platform

TypeScript, runs in the browser. Canvas 2D rendering at a fixed retro internal
resolution, integer-scaled. No server. See `docs/architecture.md` for the technical
plan, shared contracts, and testing strategy.

## 12. Glossary

- **Need / meter:** one of the five 0–100 body meters in §5.
- **Service:** a paid resident interaction (costs rubles).
- **Favor:** a free resident interaction available when broke; carries a consequence.
- **Incident:** a timed disruptive event (§7).
- **`D`:** the scalar difficulty level that rises over the shift.
- **Rubles:** in-game currency (+1/drone). **Score:** the pinball highscore metric.
  They are different things.
