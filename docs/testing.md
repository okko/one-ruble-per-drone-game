# Test Strategy & Quality Gates

> Status: **Foundation doc (mandatory).** This is the authoritative testing
> contract; it **supersedes** the summary that used to live in `architecture.md §7`
> (which now points here). Read alongside `game-design.md`, `architecture.md`,
> `compliance.md`, and `compatibility.md`.

## 1. Why this doc is stricter than usual

**This game is built by AI.** The Credits area attributes every engineering role to
Claude. That changes the threat model for quality: the risk is not a tired human
cutting a corner, it is an automated author optimizing for a **green check** and able
to make a red suite green the easy way — focusing/skipping tests, silencing the type
checker, lowering coverage, writing assertion-free or mock-only tests, or simply
asserting "all tests pass" without running them.

So our gates must be **un-gameable and machine-enforced**, not assertable. The rule
of thumb: *if a shortcut would make the gate pass without making the software
correct, the gate must mechanically forbid the shortcut.*

## 2. The CI gate is the source of truth

An area is **"done" only when CI is green** — never because an agent reports that it
is. Area 00 (Core Platform) owns `.github/workflows/ci.yml`, which runs on every push
and PR:

1. `npm run check` = `tsc --noEmit && eslint . && vitest run` (with coverage).
2. The cross-browser Playwright matrix (see `compatibility.md` §8).
3. The content-compliance lint (§8 here).
4. The focused/disabled-test grep backstop (§4).

Mutation testing (§5) runs on logic-touching PRs and nightly (kept off the fast path
so the inner loop stays quick). A lightweight **pre-push git hook** runs `npm run
check` locally so red never reaches the remote in the first place.

## 3. Test types & coverage (carried over, with additions)

Unchanged from the original strategy:

- **Unit (Vitest):** pure logic — meter drain curves, scoring math, spawn schedules
  at given seeds, economy transitions, incident triggers. Deterministic via seeded
  RNG and injected `dt`.
- **Integration (Vitest):** cross-area behavior through the event bus and
  `GameState` (e.g. "destroying a drone adds 1 ruble *and* emits `scoreChanged`").
- **DOM (jsdom):** HUD, screens, and menus render the expected text and state;
  storage round-trips. Fake/in-memory backends only. Files opt into jsdom with
  `// @vitest-environment jsdom`; the default environment stays `node`.
- **Presentation math (node, pure):** the parts of the 3D layer that *can* be tested
  without a GPU are extracted so they are — arena↔world coordinate mapping, camera
  poses and blending, damping, and the theme table. Nothing in a test constructs a
  WebGL context.
- **No flakiness:** no wall-clock, real timers, real audio hardware, real WebGL, or
  `Math.random()`. Mock Web Audio and Storage.

**Coverage — tightened.** Logic modules (`src/systems`, `src/content` validators,
scoring, meters, economy) must meet **≥ 85% lines AND ≥ 85% branches AND ≥ 85%
functions**. Lines-only is the easiest metric for an AI to satisfy without real
assertions; branch + function thresholds close that gap. Thresholds are committed in
`vitest.config.ts` and CI fails below them. **Lowering any threshold requires lead
sign-off** (enforced via CODEOWNERS on the config — see §9).

The coverage `include` set names the modules that must carry that bar. Alongside
`src/core`, `src/content`, `src/persistence`, `src/input`, `src/systems`, and the
state modules, it includes the **pure presentation modules**:

| Module | What it must prove |
|---|---|
| `src/render/three/mapping.ts` | arena↔world round-trip, anchor positions, layer ordering |
| `src/render/three/camera-director.ts` | pose table totality, blending endpoints, easing, aim-pose stability, arena coverage by the shooting frustum |
| `src/render/three/soldier.ts` | human scale, boots on the deck in every pose, yaw clamped so he cannot inherit the barrel |
| `src/render/three/theme.ts` | the token table is frozen and well-formed |
| `src/ui/shell/menu-model.ts` | wrap-around, disabled-skipping, clamping |

`soldier.ts` imports `three`, which is fine: constructing geometries and reading
transforms needs no GL context, so it runs in the default node environment like
everything else. Only the renderer needs a browser.

**Adding a module to the include set is how new code earns its coverage; removing one
is only legitimate when the module itself is deleted.** When a rendering approach is
replaced, the new pure modules are extracted, tested, and added to the include set
*before* the old ones are deleted — never the other way round, because the gap in
between is exactly where an agent would be tempted to lower a threshold.

## 4. Un-gameable gate rules (lint / config)

Area 00 wires these into `eslint.config.js`, `vitest.config.ts`, and a CI grep step:

- **No focused or disabled tests in commits.** `eslint-plugin-vitest`
  `no-focused-tests` (`.only`, `fit`, `fdescribe`) and `no-disabled-tests`
  (`.skip`, `xit`, `xdescribe`). A CI grep is the backstop in case lint is bypassed.
- **No assertion-free tests.** `eslint-plugin-vitest` `expect-expect`. A test that
  runs code but asserts nothing does not count.
- **No mock-only tautologies.** A test may not assert *only* that a mock it just
  configured was called with what it was just told to return; review rejects these.
  Prefer asserting observable behavior/state over implementation calls.
- **No silent type/lint escape hatches.** `@typescript-eslint/no-explicit-any`
  (no bare `as any`), `@typescript-eslint/ban-ts-comment` (no `@ts-ignore` /
  `@ts-expect-error` without a written justification), and
  `eslint-comments/require-description` (no bare `eslint-disable`). The existing
  `Math.random` / `Date.now` / `performance.now` bans in logic dirs remain.

## 5. Mutation testing (anti-shallow-test gate)

Add **StrykerJS** (`npm run test:mutation`) over the pure-logic dirs (`src/systems`,
`src/content` validators, scoring, meters, economy) **and the pure presentation
modules** listed in §3 (`mapping.ts`, `camera-director.ts`, `soldier.ts`,
`menu-model.ts`).
Mutation testing perturbs the
*implementation* and checks that some test fails — directly catching tests that
execute code without truly asserting its behavior, which is the dominant failure mode
of AI-written tests. Start with the score **advisory** (reported, non-blocking) and
**ratchet a minimum mutation score upward** as phases complete, so it can never
regress. Runs on logic-touching PRs and nightly, not on the fast inner-loop check.

Camera and mapping code is a particularly good mutation target: an off-by-one in a
pose or a flipped sign in a coordinate transform is invisible in a coverage report
and obvious to a mutant.

## 6. Determinism golden test

Determinism is the project's central testability claim ("same seed + same inputs ⇒
identical run"). Guard it explicitly: a test in `/tests` runs the headless sim for a
fixed number of ticks at a fixed seed and a scripted input log, then asserts a **hash
of the resulting `GameState`** equals a committed golden value. This catches
nondeterminism an AI can introduce without noticing — `Map`/`Set` iteration-order
dependence, floating-point drift, or a stray real-clock read — none of which a single
run would reveal. When intended balance changes move the golden, the diff is reviewed
and the golden updated deliberately (not auto-regenerated in CI).

## 7. Cross-browser E2E

Real-browser end-to-end testing is **mandatory**, not optional. The Playwright matrix
(Chromium + WebKit + Firefox + emulated iPhone) and its minimum suite, caveats, and
performance budget are specified in `compatibility.md §8`. It is a required CI gate.

E2E tests address the app through **stable structural selectors** — `#game3d` for the
3D canvas and `#ui` for the interface root — plus the `window.__scene` / `window.__combat`
/ `window.__audio` debug hooks. They must not assert on a fixed canvas backing-buffer
size: the canvas is now sized to the viewport and device pixel ratio, so any hard-coded
resolution assertion is wrong by construction.

### Screenshot policy

- **No screenshot snapshots of the 3D scene.** GPU, driver, and engine differences
  make them permanently flaky. Assert on state and on DOM instead.
- **No screenshot snapshots of emoji.** The UI uses system emoji, whose artwork
  differs per OS and OS version by design. Any screenshot that includes them must
  mask them.
- Screenshots are acceptable only for DOM layout that is deliberately
  engine-independent, and even then a structural assertion is preferred.
- At least one engine in the matrix runs with WebGL2 unavailable, to prove the game
  still boots, plays, and logs no console errors without a 3D backdrop.

## 8. Content-compliance gate (AI authors copy at scale)

Because the AI generates large volumes of player-facing copy, `compliance.md`'s review
is backed by automation: a **content-lint** over `src/content/` data tables and UI
copy fails CI on forbidden terms / anti-stereotype framings, and every PR touching
player-facing content carries a **structured compliance checklist reviewed by someone
other than the authoring agent**. The `compliance.md §6` watch-items (Dmitri/vodka and
the "drunk" debuff, degraded-favor flavor, regime-voice copy and highscore seed names)
are named **regression cases** the reviewer re-checks whenever that content changes.

## 9. Process gates

- **No silent scope reduction.** Each area doc's "Required automated tests" list is a
  contract and a *minimum*. Deleting or weakening a required test (or a coverage /
  mutation threshold) requires lead sign-off. **CODEOWNERS** guards `*.test.ts`,
  `/tests`, the threshold configs, and the area docs so these changes can't merge
  unreviewed.
- **Independent verification.** After an AI builds an area, a **separate reviewer
  that did not write the code** — a human, or a fresh review agent (e.g. the
  `/code-review` skill) — checks for the anti-patterns in §4–§6 and for correctness
  before merge. The author reviewing their own work does not satisfy this.
- **CI claim discipline.** "Tests pass" is meaningful only with the CI run attached.
  A report of green without a CI link is treated as unverified.

## 10. Per-area required-test contract

Every `docs/areas/*.md §8` enumerates that area's required tests as a **minimum**. An
area is not complete until those tests are authored **and** the full `npm run check`,
the Playwright matrix, the content-lint, and (for logic areas) the mutation run are
green in CI, and the independent review (§9) has signed off.
