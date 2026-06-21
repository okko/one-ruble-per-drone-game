# Area: Credits View

**Owner:** <unassigned> · **Depends on:** Core Platform (render, input, SceneManager), State & Persistence (scene machine), Art (font/palette/skyline), Audio (credits theme), Main Menu (routes here) · **Depended on by:** Main Menu, Game Over flow

> Read `docs/game-design.md` and `docs/architecture.md` first. This is the screen
> that names everyone who participated in making the game, with their titles.

## 1. Purpose

Owns the **Credits scene**: a cheerful 16-bit scrolling credits roll that lists every
contributor and their title, over the parallax Moscow skyline. Reachable from the
Main Menu (`Credits` option) and optionally chained after the high-score table on
game over. It is a view-only scene — it reads its roster from data and renders it; no
gameplay state, no mutation.

## 2. Scope

### In scope
- The `Credits` scene (`enter/update/render/onInput/exit`) plugged into the
  SceneManager (architecture.md §6).
- An auto-scrolling credits roll (vertical), grouped into titled sections, with a
  player **skip / back** control and an end behavior (loop or return to caller).
- The **credits roster** as data (`src/content/credits.ts`) — names + titles + the
  section each belongs to. This is the source of truth for "who made the game."
- Cheerful-but-grim flavor lines consistent with the game's tone (GDD §2).
- Credits music + ambience (triggered via Audio area).

### Out of scope (owned elsewhere)
- The Main Menu option that routes here (Main Menu area `07`) and the game-over →
  credits chaining decision (State `09` / Gameplay Engine `01`).
- Font, palette, and skyline rendering primitives (Art `11` / Core render).
- The credits track itself as an audio asset (Audio `06`).

## 3. Requirements & mechanics

1. **Layout:** centered column of credit lines over the parallax skyline (dimmed so
   text stays readable). Each entry renders a **title** (small caps / accent color)
   above one or more **names** (bright). Section headers separate groups.
2. **Auto-scroll:** the roll scrolls upward at a fixed, deterministic speed
   (`SCROLL_PX_PER_SEC`, driven by injected `dt` — no real clock). Speed is constant
   regardless of frame rate (fixed-timestep, architecture.md §3).
3. **Player controls:**
   - Up/Down (or hold) to scrub scroll speed faster/slower.
   - `Enter`/`Esc`/click → **back** to the caller scene (Main Menu, or the next scene
     in the game-over chain).
   - Optional: holding a key fast-forwards.
4. **End behavior:** when the last line scrolls past the top, either **loop**
   seamlessly (for the attract reel) or **auto-return** to the caller. Decided per
   entry context: looping when entered from Main Menu attract; auto-return when
   chained after game over. The scene receives this via its `enter` payload.
5. **Tone:** keep it upbeat. A closing line in the grim-cheerful spirit (e.g. a
   "Thanks for your service, soldier. Here is your ruble. ₽1" tag).
6. **Accessibility:** respects the reduced-motion / reduced-flash setting (Settings,
   Persistence area) — if set, no auto-scroll; the player pages through instead.
7. **No persistence side effects.** Viewing credits changes nothing stored. (An
   optional cosmetic "seen credits" flag may be set via the MetaStats repo, but it is
   not required.)

## 4. Public interface (TypeScript)

```ts
// src/ui/credits-scene.ts
export interface CreditsEnterArgs {
  endBehavior: 'loop' | 'return';
  returnTo: SceneId;          // where 'back'/'return' goes (e.g. 'MainMenu')
}

export interface CreditsScene extends Scene {
  enter(args: CreditsEnterArgs): void;
}

// Local view state (not gameplay state)
export interface CreditsViewState {
  scrollY: number;            // px scrolled; advanced by dt * speed
  speed: number;              // current scroll px/sec (scrubbable)
  finished: boolean;
}

export function updateCredits(v: CreditsViewState, dt: number, roster: CreditsRoster): void;
export function renderCredits(r: Renderer, v: CreditsViewState, roster: CreditsRoster): void;
```

No new event-bus events required (it only calls `sceneManager.replace(returnTo)` /
loops). If a game-over chain is used, State area owns the transition; this scene just
signals completion via its `returnTo`.

## 5. Data / content tables

`src/content/credits.ts` — the roster (data, the answer to "who participated, with
what title"). Shape:

```ts
export interface CreditEntry { title: string; names: string[] }
export interface CreditSection { heading: string; entries: CreditEntry[] }
export type CreditsRoster = CreditSection[];

export const CREDITS: CreditsRoster = [
  {
    heading: 'Concept & Creative Direction',
    entries: [
      { title: 'Creator · Concept & Creative Direction', names: ['Okko Ojala'] },
    ],
  },
  {
    heading: 'Production',
    entries: [
      { title: 'Executive Associate Producer', names: ['Tuomas Vehmainen'] },
      { title: 'Associate Producer',           names: ['Mika Viljanen'] },
    ],
  },
  {
    heading: 'Lead Development & Game Design',
    entries: [
      { title: 'Lead Developer & Game Designer', names: ['Claude'] },
    ],
  },
  {
    heading: 'Area Engineering',
    entries: [
      { title: 'Core Platform & Build Engineer',        names: ['Claude'] },
      { title: 'Gameplay Engine Engineer',              names: ['Claude'] },
      { title: 'Gameplay Status / Meters Engineer',     names: ['Claude'] },
      { title: 'Economy & Residents Engineer',          names: ['Claude'] },
      { title: 'Scoring (Pinball) Engineer',            names: ['Claude'] },
      { title: 'Random Incidents — Designer & Engineer',names: ['Claude'] },
      { title: 'Audio Engineer (Music & SFX)',          names: ['Claude'] },
      { title: 'Main Menu Engineer',                    names: ['Claude'] },
      { title: 'Highscores Engineer',                   names: ['Claude'] },
      { title: 'State & Persistence Engineer',          names: ['Claude'] },
      { title: 'HUD & In-game UI Engineer',             names: ['Claude'] },
      { title: 'Art & Visual Style / Pixel Artist',     names: ['Claude'] },
      { title: 'Credits Engineer',                      names: ['Claude'] },
    ],
  },
  {
    heading: 'Tools & Technology',
    entries: [
      { title: 'Built with', names: ['TypeScript', 'Vite', 'Canvas 2D', 'Web Audio API', 'Vitest'] },
      { title: 'AI development', names: ['Claude'] },
    ],
  },
  {
    heading: 'Special Thanks',
    entries: [
      { title: 'For the favors', names: ['The residents of the skyscraper'] },
      { title: 'For your service, soldier', names: ['₽1'] },
    ],
  },
];
```

Honesty note: this game is built by Claude under the
creative direction of the human creator. The roster reflects that truthfully — keep
it accurate as real contributors are added; do not invent fictitious people. The
per-area titles map 1:1 to the areas in `docs/README.md`.

## 6. Persistence

None required. Reads the reduced-motion setting from the Settings repo (Persistence
area `09`). May optionally set a cosmetic `seenCredits` flag via MetaStatsRepo —
not required for done.

## 7. Dependencies & integration

**Reads:** `content.credits` (the roster), Settings (reduced-motion), injected `dt`.
**Calls:** `sceneManager.replace(returnTo)` on back/return; loops internally on
`endBehavior:'loop'`.
**Triggered by:** Main Menu `Credits` option (and optionally the game-over chain).
**Uses:** Art font/palette/skyline (render), Audio credits theme.
Integration rule (architecture.md §8): view + scene-transition only; no reaching into
other areas' internals.

## 8. Required automated tests (MUST pass)

Under `jsdom`; deterministic (injected `dt`); `npm run check` green per
architecture.md §7. Minimum:

1. **Roster renders:** every `CreditEntry` (title + each name) and every section
   `heading` in `CREDITS` is drawn/present in the rendered output.
2. **Roster data validity:** every entry has a non-empty `title` and ≥1 non-empty
   name; every section has a heading and ≥1 entry (a content-validation unit test).
3. **Deterministic scroll:** `updateCredits` advances `scrollY` by exactly
   `dt * speed`; same `dt` sequence ⇒ same `scrollY`. No `Date.now()` / `Math.random()`.
4. **Scrub controls:** Up/Down change `speed` within clamped bounds.
5. **Back/return:** `Enter`/`Esc`/click triggers a transition to `returnTo`
   (assert `sceneManager.replace` called with the right `SceneId`).
6. **End behavior:** with `endBehavior:'loop'`, `scrollY` wraps and `finished` stays
   false; with `'return'`, reaching the end sets `finished` and transitions to
   `returnTo`.
7. **Reduced-motion:** with the setting on, auto-scroll is disabled and paging input
   advances sections instead.
8. **No mutation:** rendering performs no gameplay-state mutation.

## 9. Acceptance criteria / Definition of done

- [ ] `Credits` scene implemented and registered with the SceneManager; reachable
      from the Main Menu `Credits` option.
- [ ] Auto-scroll deterministic via injected `dt`; both `loop` and `return` end
      behaviors work; reduced-motion honored.
- [ ] Roster lives in `src/content/credits.ts`, lists real contributors with titles
      (no fabricated names), and maps 1:1 to the area list.
- [ ] All §8 tests authored and passing; `npm run check` green.
- [ ] Tone reviewed (cheerful over grim, GDD §2).

## 10. Open questions / risks

- **Game-over chaining:** confirm with State (`09`) / Gameplay Engine (`01`) whether
  credits auto-play after the high-score table or only from the menu.
- **Roster growth:** if real human collaborators join, add them with accurate titles;
  keep the AI-built attribution honest.
- **Localization:** titles/headings should be localizable later (keep strings in the
  content table, not in render code).
- **Skyline reuse:** coordinate with Art so the credits backdrop reuses the menu's
  parallax layers rather than a bespoke asset.
