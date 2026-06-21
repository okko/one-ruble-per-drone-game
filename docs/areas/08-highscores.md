# Area: Highscores (view, list & entry)

**Owner:** <unassigned> · **Depends on:** State & Persistence (09), HUD & Art for
visual style (10, 11) · **Depended on by:** Gameplay Engine (01, fires game over),
Main Menu (07, links to the list)

## 1. Purpose

Owns everything about the highscore experience: the **data model** for a score
entry, the **qualification** check (does a finished run make the table?), the
**HighscoreEntry** scene (retro name input + insert + persist), and the
**Highscores** list scene (render the sorted top-N). This area reads and writes
score data exclusively through the Persistence area's repository interface — it
never touches `localStorage` directly.

## 2. Scope

### In scope
- The `HighscoreEntry` type and the in-memory sorted-table operations (qualify,
  insert, trim, sort, tie-break).
- The `HighscoreEntry` scene: retro initials/name input via keyboard **and** an
  on-screen character picker (D-pad/arrow + confirm), validation, and committing the
  new entry.
- The `Highscores` list scene: rendering the top-N table with rank, name, score,
  shift length, date, and one notable stat; highlighting the freshly entered row;
  cheerful-but-grim flavor lines; navigation back to the Main Menu.
- Default/seed table content for a fresh install.

### Out of scope (owned elsewhere)
- Raw `localStorage` access, JSON (de)serialization, schema versioning, and
  migrations — owned by **State & Persistence (09)**. This area calls that repo.
- Deciding *when* the run ends and what the final score is — owned by **Gameplay
  Engine (01)** / the scene machine in **State (09)**. This area is *routed to* with
  a finished-run payload.
- Pixel font, palette, table chrome, and frame art — owned by **Art (11)** and drawn
  via **HUD & UI (10)** primitives.

## 3. Requirements & mechanics

1. **Table size:** keep the top **N = 10** entries. `MAX_NAME_LEN = 12`,
   `MIN_NAME_LEN = 1`. Default initials placeholder: `AAA`.
2. **Ordering:** sort by `score` descending. **Tie-break** (deterministic, stable):
   higher `score` → longer `shiftLengthSeconds` → more `dronesDowned` → earlier
   `dateISO` (older run keeps the higher rank on a full tie). Never rely on insertion
   order alone; the comparator must fully order entries.
3. **Qualification:** a finished run **qualifies** if the table has fewer than `N`
   entries, **or** its score is strictly greater than the lowest entry's score
   currently on the table. (Strictly greater so an equal score does not bump an
   existing equal entry — equal newcomers only get in while the table is not full.)
   The qualification check is a pure function of `(finalScore, currentTable)`.
4. **Flow / where it's called:** on `gameOver` the State machine routes to this
   area with the run payload. This area runs the qualification check:
   - **Qualifies →** enter `HighscoreEntry` scene → on confirm, insert + persist →
     enter `Highscores` list scene with the new row highlighted.
   - **Does not qualify →** skip entry, go straight to `Highscores` list (no
     highlight), or to a "didn't make the cut" cheerful-but-grim summary then the
     list. Coordinate the exact route with State (09).
5. **Insert + trim:** inserting puts the entry at its correctly sorted position;
   if the table now exceeds `N`, drop the lowest-ranked entry. A newly inserted entry
   that immediately falls to position `N+1` is discarded (can only happen via a race;
   qualification should prevent it).
6. **HighscoreEntry scene:**
   - Keyboard typing fills the name; Backspace deletes; Enter confirms.
   - On-screen **character picker**: arrow/D-pad moves a cursor over a retro glyph
     grid (`A–Z`, `0–9`, space, a few punctuation), confirm appends, a `DEL` and
     `END` cell handle delete/confirm — fully playable without a physical keyboard.
   - **Validation:** trim trailing spaces; enforce `MIN_NAME_LEN`/`MAX_NAME_LEN`;
     restrict to the allowed glyph set; empty/whitespace-only names fall back to the
     placeholder. Reject nothing silently — show the clamped result.
7. **Highscores list scene:** render N rows (rank `1..N`), each showing name, score
   (right-aligned, thousands separators), shift length (`mm:ss`), date (short
   localized or `YYYY-MM-DD`), and one **notable stat** (e.g. drones downed, or a
   chosen highlight). Highlight the just-entered row (blink/color). Show a cheerful-
   but-grim header and rotating flavor line. `Back`/`Esc`/confirm returns to Main
   Menu.
8. **Empty / fresh install:** seed the table with `N` cheeky default entries
   (grim-funny fake names + modest descending scores) so the screen is never empty
   and new players have something to beat. Seeding is done once by the Persistence
   repo's "load or initialize" path; this area provides the default dataset.
9. **Cheerful-but-grim tone:** all copy stays upbeat in presentation (e.g. "NEW
   PERSONAL BEST, COMRADE!") regardless of the bleak premise. Flavor lines are data,
   not hard-coded in logic.

## 4. Public interface (TypeScript)

```ts
// src/ui/highscores/types.ts
export interface HighscoreEntry {
  name: string;              // validated, MIN..MAX_NAME_LEN, allowed glyphs
  score: number;             // pinball score (NOT rubles)
  shiftLengthSeconds: number;
  dronesDowned: number;
  dateISO: string;           // ISO-8601 UTC; produced at game over, passed in (not via Date.now() in logic)
  notable?: string;          // short pre-rendered highlight, e.g. "12x combo"
}

export const HIGHSCORE_CAP = 10;
export const MIN_NAME_LEN = 1;
export const MAX_NAME_LEN = 12;

// src/ui/highscores/table.ts  (PURE logic — fully unit-tested)
export function compareEntries(a: HighscoreEntry, b: HighscoreEntry): number;
export function sortTable(entries: HighscoreEntry[]): HighscoreEntry[];
export function qualifies(finalScore: number, table: HighscoreEntry[]): boolean;
export function insertEntry(
  table: HighscoreEntry[],
  entry: HighscoreEntry,
): { table: HighscoreEntry[]; rank: number | null }; // rank = 1-based slot, null if dropped
export function validateName(raw: string): string;   // clamp/sanitize → final name
export const DEFAULT_TABLE: HighscoreEntry[];         // seed data

// Scenes (implement the Scene interface from architecture.md §6)
// src/ui/highscores/entry-scene.ts   → HighscoreEntryScene(runPayload)
// src/ui/highscores/list-scene.ts    → HighscoresListScene({ highlightRank? })
```

The scenes receive the persistence repo (below) via `SystemContext`/scene props —
injected, never imported as a singleton, so tests can pass a fake.

## 5. Data / content tables

- `DEFAULT_TABLE`: 10 seed entries (grim-funny names, descending scores), living in
  `src/content/highscores.defaults.ts`.
- `FLAVOR_LINES`: array of cheerful-but-grim strings shown on the list/entry screens,
  in `src/content/highscores.flavor.ts`.
- Allowed glyph set for names: `src/content/highscores.glyphs.ts`.

## 6. Persistence

This area performs **no** raw storage. It consumes the repo exposed by **State &
Persistence (09)**:

```ts
export interface HighscoreRepo {
  load(): HighscoreEntry[];          // returns sorted top-N, seeded with DEFAULT_TABLE if empty
  save(table: HighscoreEntry[]): void;
}
```

The repo handles `localStorage` keys, JSON, schema version, and migrations.
Boundary rule: if you find yourself importing `window.localStorage` here, stop — it
belongs in area 09.

## 7. Dependencies & integration

- **Consumes event:** `gameOver { score, cause }` (plus a fuller run payload from the
  scene machine: shift length, drones downed, notable stat).
- **Emits:** none required; may emit a UI navigation intent handled by the
  SceneManager.
- **Injected ctx:** `HighscoreRepo` (from 09); render primitives from HUD/UI (10);
  font/palette from Art (11).
- **Reads slices:** the finished-run summary assembled from `GameState`
  (`scoring.total`, `time.shiftSeconds`, `combat` drone count) — passed in at game
  over, not pulled live.

## 8. Required automated tests (MUST pass)

All tests deterministic; no real `localStorage`, no wall clock — inject a
**fake/in-memory `HighscoreRepo`** and pass `dateISO` explicitly. Per
`architecture.md §7`, `npm run check` must be green.

Unit (pure logic — `table.ts`):
1. **qualifies — table not full:** any score (even 0) qualifies when fewer than N
   entries exist.
2. **qualifies — table full, above lowest:** score strictly greater than the lowest
   qualifies.
3. **does not qualify — table full, equal-or-below lowest:** equal score and lower
   score both fail.
4. **insert at correct sorted position:** inserting a mid-value entry lands at the
   right 1-based rank; returned `rank` matches.
5. **insert into full table drops lowest:** length stays `N`; previous lowest is
   gone; a non-qualifying insert returns `rank: null` and leaves the table unchanged.
6. **tie handling:** entries with equal scores order by the documented tie-break
   chain (shift length → drones → older date); comparator is a total order
   (antisymmetric/transitive spot-checks).
7. **sortTable:** an unsorted array sorts to fully ordered top-N.
8. **name validation:** over-length clamps to `MAX_NAME_LEN`; empty/whitespace →
   placeholder; disallowed glyphs stripped/blocked; min-length enforced.
9. **default table:** `DEFAULT_TABLE` has exactly N entries and is already sorted.

Integration / persistence (fake repo):
10. **persist + reload round-trip:** insert via the repo, reload, and get the same
    sorted top-N back.
11. **empty store seeds defaults:** loading an empty repo returns `DEFAULT_TABLE`.

DOM / scene (jsdom):
12. **list renders top-N sorted:** rendered output contains N rows in score-desc
    order with rank/name/score/shift/date/notable fields present.
13. **highlight:** list scene given `highlightRank` marks exactly that row.
14. **entry scene — keyboard path:** typing + Enter produces a validated entry and
    calls `repo.save` once with the inserted table.
15. **entry scene — character-picker path:** picker navigation + confirm builds the
    same name without a physical keyboard; `DEL`/`END` cells work.
16. **game-over routing:** qualifying score routes to entry then list (highlighted);
    non-qualifying score skips entry and shows the list unhighlighted.

## 9. Acceptance criteria / Definition of done

On top of the global DoD (`architecture.md §9`):
- [ ] `qualifies`, `insertEntry`, `compareEntries`, `sortTable`, `validateName` are
      pure and fully unit-tested (≥ 85% line coverage for `table.ts`).
- [ ] No direct `localStorage` access anywhere in this area; all I/O via
      `HighscoreRepo`.
- [ ] Both scenes implement the Scene interface and are reachable per the
      game-over/main-menu routing.
- [ ] Character picker makes name entry fully possible without a physical keyboard.
- [ ] Fresh install shows a seeded, sorted table; never an empty screen.
- [ ] All tests in §8 authored and passing; `npm run check` green.

## 10. Open questions / risks

- **Date source:** `dateISO` must be generated at game over and passed in (logic
  stays clock-free per architecture.md §3.3). Confirm who stamps it — recommend the
  scene machine at game over.
- **Notable stat selection:** which single stat to surface (max combo? biggest
  jackpot? a funny "cause of death"?) — coordinate with Scoring (04) and Gameplay
  Engine (01).
- **Score vs rubles:** confirm the table stores the **pinball score**, not rubles
  (per GDD §8); the run payload must carry the right number.
- **Name profanity/length for retro feel:** decide whether to keep classic 3-char
  arcade initials instead of 12 — flagged for the lead; current spec allows up to 12
  with a 3-char default.
