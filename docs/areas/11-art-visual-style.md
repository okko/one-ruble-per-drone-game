# Area: Art & Visual Style

**Owner:** <unassigned> · **Depends on:** Core Platform & Build (render/atlas
loader), Gameplay Engine (drone type list) · **Depended on by:** HUD & In-game UI,
Economy & Residents (portraits), Gameplay Engine (sprites), Main Menu, Highscores,
Random Incidents (visual overlays)

## 1. Purpose

This area defines the **art bible** for "One Ruble Per Drone" — the palette, sprite
specs, backgrounds, font, and animation guidelines that give the game its bright,
cheerful 16-bit SNES-era look over a grim satirical premise (GDD §2) — **and** owns
the **asset-pipeline contract**: the sprite-atlas format, the typed asset manifest
that maps sprite ids to atlas coordinates/frames, and a placeholder-art provider so
no other area is ever blocked waiting on final pixels.

## 2. Scope

### In scope
- The canonical color **palette** (typed, frozen constants in code).
- **Sprite specifications**: pixel dimensions, frame counts, pivots for every game
  object (soldier, gun, drones, explosions, ruble, residents, HUD chrome, icons).
- **Backgrounds**: parallax Moscow skyline layers and day/night palette shifts.
- **Incident/weather visual overlays** (blackout, flicker, propaganda bars, etc.).
- **Pixel font** spec for HUD and menus.
- **Animation guidelines** (frame counts + timing) consumed by Render.
- The **asset manifest schema**, the **SpriteId registry** (single source of truth),
  the **atlas format**, and the **placeholder-art provider**.

### Out of scope (owned elsewhere)
- The actual `drawSprite` / canvas blitting and atlas image loading — **Core/Render**
  consumes this area's manifest and palette (we define the contract; they implement
  the loader).
- HUD layout and which icons appear where — **HUD area** (we supply the icons).
- Drone gameplay stats/behavior — **Gameplay Engine** (we supply the visuals and
  agree the type list with them).
- Producing final, finished pixel art (an art-production task) — this doc defines
  the specs, ids, and placeholders the engineering depends on; final art slots into
  the same ids later with zero code changes.

## 3. Requirements & mechanics

### 3.1 Aesthetic direction
- Bright, saturated SNES-era palette. Sunny skies, glinting onion domes, chunky
  readable sprites with a 1px dark outline (`ink`).
- The darkness lives in content/writing, **never** in the rendering: keep colors
  cheerful even during grim events (a "you soiled yourself" crisis flashes in
  friendly game-show colors). This contrast is the identity.
- Target internal resolution **384×216** (per architecture.md §1), integer-scaled.
  Design every sprite for this resolution; assume `image-rendering: pixelated`.

### 3.2 Palette
A tight 32-swatch palette. Exported from `src/render/palette.ts` as a frozen object;
**no color literals anywhere else in the codebase** — code references palette keys.

| Group | Key | Hex |
|---|---|---|
| Line/shadow | `ink` | `#1a1c2c` |
|  | `shadow` | `#2b2f4a` |
| Sky (day) | `skyDayTop` | `#4fc3ff` |
|  | `skyDayMid` | `#8be9fd` |
|  | `skyDayLow` | `#fff4b8` |
| Sky (night) | `skyNightTop` | `#1b1f5c` |
|  | `skyNightMid` | `#3a2f7a` |
| Clouds | `cloud` | `#ffffff` |
| Domes | `domeGold` | `#ffcb3d` |
|  | `domeTeal` | `#2ec4b6` |
|  | `domeRed` | `#e84a5f` |
| Buildings | `concrete` | `#9aa0b5` |
|  | `concreteDk` | `#6b7088` |
|  | `windowLit` | `#ffe066` |
|  | `windowDark` | `#3b4a6b` |
| Soldier | `uniform` | `#6e7d3b` |
|  | `uniformDk` | `#4a5526` |
|  | `skin` | `#f2c79a` |
|  | `skinDk` | `#c98e63` |
| Gun/FX | `gunmetal` | `#5a6172` |
|  | `gunmetalDk` | `#353a4a` |
|  | `flash` | `#fff3b0` |
|  | `flashHot` | `#ff9f1c` |
| Drones | `droneBody` | `#4b5063` |
|  | `droneScout` | `#5ad1ff` |
|  | `droneBomber` | `#ff5d5d` |
|  | `droneSwarm` | `#b06cff` |
|  | `droneBoss` | `#ff2e63` |
| Explosion/smoke | `explYellow` | `#ffd23f` |
|  | `explOrange` | `#ff7b00` |
|  | `smoke` | `#c7ccd6` |
| Economy | `rubleGold` | `#ffd93d` |
| UI | `panel` | `#2440a0` |
|  | `panelLite` | `#4f7cff` |
|  | `cream` | `#fff6e6` |
|  | `accentPink` | `#ff5db1` |
| Meters | `meterGood` | `#3ddc84` |
|  | `meterWarn` | `#ffb627` |
|  | `meterCrit` | `#ff3b3b` |

> The table lists ~37 keys; the budget for the *core* palette is **≤32** simultaneous
> hues — the meter/UI accents (`meterGood/Warn/Crit`, `panel*`, `accentPink`,
> `cream`, `rubleGold`) overlap with the sky/explosion ramps in practice. The test
> in §8 enforces a hard cap of **32 unique hex values**; if we exceed it, dedupe
> near-duplicates (e.g. reuse `explYellow` for `windowLit`).

### 3.3 Sprite specifications

All sizes in source pixels at 384×216 internal res. Default pivot is **center-bottom**
unless noted; drones/projectiles/explosions use **center**.

| Subject | Sprite id(s) | Size (px) | Frames | Notes |
|---|---|---|---|---|
| Soldier at post (idle/fire/recoil) | `soldier.idle`, `soldier.fire` | 32×40 | idle 2, fire 2 | seated/braced; ushanka; recoil offset done in code |
| Soldier states (yawn/desperate) | `soldier.tired`, `soldier.crisis` | 32×40 | 2 each | swapped when meters critical |
| Machine gun | `gun.base` | 28×16 | 1 | rotates around mount pivot |
| Muzzle flash | `gun.flash` | 16×16 | 3 | additive-feel, `flash`/`flashHot` |
| Drone — Scout (fast/weak) | `drone.scout` | 16×16 | 4 (rotor) | `droneScout` accent |
| Drone — Bomber (slow/tough, damages post) | `drone.bomber` | 24×24 | 4 | `droneBomber` accent |
| Drone — Swarm (tiny, many) | `drone.swarm` | 12×12 | 2 | `droneSwarm` accent |
| Drone — Armored (needs 2+ hits) | `drone.armored` | 24×20 | 4 | metal plating |
| Drone — Special/jackpot (colored) | `drone.special` | 16×16 | 4 | tints by code for letter sequences |
| Drone — Boss/Mega | `drone.boss` | 48×48 | 6 | major-attack incident |
| Decoy bird (penalty if shot) | `decoy.bird` | 16×12 | 3 | bird-flock incident |
| Projectile/tracer | `fx.tracer` | 4×4 | 1 | mostly code-drawn line + this tip |
| Explosion | `fx.explosion` | 32×32 | 6 | ~50ms/frame |
| Small hit spark | `fx.spark` | 8×8 | 3 | on armored deflection |
| Ruble pickup/coin | `pickup.ruble` | 8×8 | 4 (shine) | optional floating pickup |
| Resident portrait | `portrait.<id>` | 64×64 | 1–2 (talk) | bust framing for interaction UI |
| HUD panel chrome | `ui.panel`, `ui.panel.corner` | 9-slice | 1 | cheerful `panel`/`panelLite` |
| Meter bar (frame + fill) | `ui.meter.frame`, `ui.meter.fill` | 48×8 | 1 | fill tinted good/warn/crit in code |
| Button (normal/hover/press) | `ui.btn`, `ui.btn.hover`, `ui.btn.press` | 9-slice | 1 | menus |
| Need icons | see §3.4 | 12×12 | 1 | — |

> **Drone type list is provisional** (`scout`, `bomber`, `swarm`, `armored`,
> `special`, `boss`) and **must be reconciled with the Gameplay Engine area**. Sprite
> ids follow whatever final set is agreed; the registry in §4 is the single source of
> truth both areas import.

### 3.4 Need indicators — emoji vs pixel icon
- The GDD §5 **mandates** the poo meter use the literal **💩 emoji**. So `icon.poo`
  is rendered as the emoji glyph via canvas `fillText` (system emoji font), boxed to
  12×12.
- **Recommendation:** render the other four (😴 sleep, 🍞 hunger, 💧 thirst, 🚬 vice)
  as **custom 12×12 pixel icons** in the atlas, not emoji. Justification: (a) visual
  consistency with the pixel art — system emoji break the 16-bit illusion and vary
  per OS; (b) deterministic rendering and testability; (c) full palette control.
  💩 is the deliberate exception the design calls for, and its incongruity is on-theme.
- Provide an **emoji-glyph fallback** path in the manifest (`glyph` field) so any icon
  can fall back to an emoji if a pixel icon is missing — keeps areas unblocked.
- Icon ids: `icon.sleep`, `icon.poo` (glyph 💩), `icon.hunger`, `icon.thirst`,
  `icon.vice`, plus `icon.ruble`.

### 3.5 Backgrounds — parallax skyline & day/night
- **Layers (back→front):** `bg.sky` (gradient, code-drawn from palette), `bg.far`
  (distant onion-dome skyline, slow parallax), `bg.mid` (brutalist towers), `bg.near`
  (the rooftop edge / sandbags around the post). Parallax factors ~`0.1 / 0.3 / 0.6`.
- **Day/night:** the sky gradient and a global tint interpolate between day
  (`skyDay*`) and night (`skyNight*`) palettes driven by `time.phase`/a 0–1 daylight
  value provided by the Gameplay Engine/Meters time system. Lit windows (`windowLit`)
  fade in at night. Provide a `daylight(t)` → palette-mix spec so Render can lerp.
- **Sun/moon** sprite `bg.sun` / `bg.moon` (16×16) tracks the cycle.

### 3.6 Incident & weather overlays
Visual treatments the Random Incidents area triggers (we define how they *look*):
- **Blackout (electrical):** darken everything via a `shadow` multiply overlay to
  ~25% brightness; only muzzle flash + drone accents readable.
- **HUD flicker:** code-driven alpha jitter on HUD layer.
- **Propaganda broadcast:** cheerful `panel`/`accentPink` letterbox bars + a portrait.
- **Pipe failure:** a small dripping `fx.drip` motif near the toilet UI.
- **Supply shortage / inspection:** a banner using `ui.panel`.
All overlays must respect the **reduced-flashing** accessibility flag (§7).

### 3.7 Pixel font
- **Recommendation:** a **baked bitmap font in the atlas**, two sizes: an **8×8**
  display/menu font and a denser **5×7** HUD font. Justification: no web-font network
  load (no FOUT/flake), fully deterministic and testable, palette-tintable.
- Glyph coverage: ASCII 32–126 plus `₽` (ruble sign) and arrows. Cyrillic optional
  later; copy is satirical English by default.
- Manifest exposes the font as a sprite strip + a `glyphWidth`/`glyphHeight`/`first
  charcode` descriptor so Render's text routine can index it.

### 3.8 Animation guidelines (frame counts + timing)
Render consumes these; "code-driven" means no atlas frames, animated by transform.
- **Gun fire:** 3-frame `gun.flash`, ~60–90 ms total (~25 ms/frame); 2px code recoil
  kickback decaying over ~120 ms.
- **Drone movement:** 2–4 frame rotor loop at **10–12 fps**; vertical bob is
  code-driven (sine), not frames.
- **Explosion:** 6 frames at ~**50 ms/frame** (~300 ms); spawn 2–3 `smoke` puffs
  (code-driven, fade over ~500 ms).
- **Meter crisis flash:** **code-driven** blink between `meterCrit` and `cream` at
  **~4 Hz**; **disabled** (steady `meterCrit`) when reduced-flashing is on.
- **Score pop:** code-driven scale 1.4→1.0 + 6px rise over ~**400 ms**, ease-out;
  digits are font glyphs tinted `cream` with `ink` shadow.
- **Coin/ruble:** 4-frame shine loop at 8 fps, or a code-driven spin.

## 4. Public interface (TypeScript)

```ts
// src/render/palette.ts
export const PALETTE = Object.freeze({
  ink: '#1a1c2c', /* …all keys from §3.2… */ meterCrit: '#ff3b3b',
} as const);
export type PaletteKey = keyof typeof PALETTE;

// src/content/sprite-ids.ts — SINGLE SOURCE OF TRUTH for every sprite id
export const SPRITE_IDS = [
  'soldier.idle', 'soldier.fire', 'soldier.tired', 'soldier.crisis',
  'gun.base', 'gun.flash',
  'drone.scout', 'drone.bomber', 'drone.swarm', 'drone.armored',
  'drone.special', 'drone.boss', 'decoy.bird',
  'fx.tracer', 'fx.explosion', 'fx.spark', 'fx.drip',
  'pickup.ruble',
  'ui.panel', 'ui.panel.corner', 'ui.meter.frame', 'ui.meter.fill',
  'ui.btn', 'ui.btn.hover', 'ui.btn.press',
  'icon.sleep', 'icon.poo', 'icon.hunger', 'icon.thirst', 'icon.vice', 'icon.ruble',
  'bg.sun', 'bg.moon',
  'font.display', 'font.hud',
  // portrait.* ids are registered dynamically from the resident roster (Economy area)
] as const;
export type SpriteId = (typeof SPRITE_IDS)[number] | `portrait.${string}`;

// src/content/assets.ts — manifest types
export interface AssetManifest {
  version: number;
  atlas: { image: string; width: number; height: number };
  sprites: Record<string, SpriteDef>;
}
export interface SpriteDef {
  x: number; y: number; w: number; h: number;
  pivot?: [number, number];            // default [w/2, h] (center-bottom)
  glyph?: string;                       // emoji/text fallback (e.g. '💩')
  anim?: { frames: number; fps: number; layout: 'horizontal' | 'rects'; rects?: Rect[] };
  font?: { glyphW: number; glyphH: number; firstCharCode: number };
}
export interface Rect { x: number; y: number; w: number; h: number; }

// src/render/sprite-provider.ts — both real & placeholder conform
export interface SpriteProvider {
  has(id: SpriteId): boolean;
  resolve(id: SpriteId, frame?: number): ResolvedSprite; // throws on unknown id
}
export interface ResolvedSprite {
  source: 'atlas' | 'placeholder' | 'glyph';
  rect: Rect; pivot: [number, number]; glyph?: string;
}
```

## 5. Data / content tables

- `src/content/assets.manifest.json` — the atlas manifest (validated against the
  schema in §8). One real-art version and the loader auto-falls-back to placeholders
  for any missing id.
- `src/render/palette.ts` — the frozen palette (§3.2).
- `src/content/sprite-ids.ts` — the `SpriteId` registry (§4); the contract every
  area imports instead of hard-coding string ids.
- Atlas image: a single PNG sprite sheet, **512×512** max, power-of-two; multiple
  sheets allowed later via `atlas.image` per-manifest (v2).

## 6. Persistence

**None** written by this area. It **consumes** two accessibility flags owned by the
Settings/Persistence area: `reducedFlashing` (disables crisis/flicker blinking) and
`reducedMotion` (shortens/removes non-essential tweens). If those flags are absent,
default to flashing/motion **on**.

## 7. Dependencies & integration

- **Core/Render** loads `assets.manifest.json` + the atlas image, constructs the real
  `SpriteProvider`, and falls back to the **placeholder provider** for any id not yet
  in the atlas. We own both providers' contract; Render owns the blit.
- **Gameplay Engine**: agree the final drone type list; sprite ids track it.
- **Economy & Residents**: supplies the resident roster; `portrait.<id>` ids are
  registered from that roster, and the validation test (§8) checks each roster id has
  a portrait or a placeholder.
- **HUD / Menus / Highscores / Incidents**: consume palette keys, icons, chrome
  sprites, the font, and overlay specs.
- Emits **no events**; purely provides data + draw-spec contracts.

### Placeholder-art plan (un-blocks everyone)
- `PlaceholderProvider implements SpriteProvider` draws **palette-keyed colored
  shapes** for every `SpriteId`: drones as accent-colored circles, soldier/gun as
  labeled rects, explosions as expanding yellow rings, icons as their `glyph` (emoji)
  or a colored square with a 1-letter label, font as the system monospace.
- A single boolean (`useRealAtlas`, defaulting to whatever the manifest supports per
  id) selects real-vs-placeholder **per id**, so partially-finished art works.
- Therefore other areas code against `SpriteId`s from day one and never wait on art.

## 8. Required automated tests (MUST pass)

Per architecture.md §7 — `tsc --noEmit`, ESLint, and `vitest run` must all be green.

1. **Manifest schema validation:** `assets.manifest.json` validates against the
   `AssetManifest`/`SpriteDef` schema — correct types, no negative `x/y/w/h`,
   `frames ≥ 1`, `fps > 0` when `anim` present, `version` is a positive int.
2. **Atlas-bounds:** every sprite rect — and every animation frame rect (computed for
   `layout:'horizontal'` or each `rects[]` entry) — lies fully within
   `atlas.width × atlas.height`. No overlaps for distinct ids (warning-level allowed).
3. **No dangling ids (forward):** every id in `SPRITE_IDS` resolves to a manifest
   entry **or** has a defined `glyph`/placeholder; `provider.resolve(id)` never throws
   for a registered id.
4. **No orphan entries (reverse):** every manifest sprite key is a known `SpriteId`
   (or a `portrait.*`); flag unknown keys.
5. **Referenced-id coverage:** a static scan of `src/` + `src/content/` data for
   sprite-id usages confirms each referenced id is in `SPRITE_IDS` (catches typos and
   ad-hoc string ids).
6. **Palette frozen & valid:** `Object.isFrozen(PALETTE)` is true; every value matches
   `/^#[0-9a-f]{6}$/`; **unique hex count ≤ 32** (enforces the budget in §3.2).
7. **Placeholder parity:** `PlaceholderProvider.has(id)` is true and `resolve(id)`
   returns a non-null `ResolvedSprite` for **every** `SpriteId` (and a sampled set of
   `portrait.*` ids) — guarantees nothing is unrenderable.
8. **Pivot defaults:** `resolve` applies center-bottom default pivot when `pivot` is
   omitted, and the given pivot otherwise (unit test).
9. **Font descriptor:** `font.display`/`font.hud` carry a valid `font{}` descriptor;
   a text-measurement helper returns expected width for a known string.

## 9. Acceptance criteria / Definition of done

On top of the global DoD (architecture.md §9):
- [ ] `PALETTE` exported, frozen, ≤32 unique hexes; no color literals elsewhere in
      the codebase (lint rule or test).
- [ ] `SPRITE_IDS`/`SpriteId` registry is the only place sprite-id strings are
      declared; all areas import from it.
- [ ] `AssetManifest` schema + a real `assets.manifest.json` (may reference a stub
      atlas) both present and validated by tests.
- [ ] Both `SpriteProvider` implementations (real loader contract + placeholder)
      satisfy the interface; placeholder covers 100% of `SpriteId`s.
- [ ] Drone type list reconciled with Gameplay Engine; ids updated to match.
- [ ] Animation/timing table (§3.8) and overlay specs (§3.6) documented for Render.
- [ ] All §8 tests authored and passing; `npm run check` green.

## 10. Open questions / risks

- **Drone roster churn:** if Gameplay Engine changes drone types, sprite ids and the
  placeholder map must follow. Mitigated by the single `SPRITE_IDS` registry.
- **Emoji rendering variance:** 💩 (and any `glyph` fallback) looks different per
  OS/browser and may not be pixel-aligned. Accept for 💩 (on-theme, mandated); test
  only that it renders non-empty, not its appearance.
- **Palette budget pressure:** 16-bit feel wants restraint, but UI + meters + sky
  ramps compete for the 32 slots. May need to share ramps (test enforces the cap).
- **Atlas growth:** one 512×512 sheet may not hold portraits for a large resident
  roster; v2 manifest allows multiple atlas images.
- **Reduced-motion semantics:** need Settings area to finalize the flag names; we
  assume `reducedFlashing` / `reducedMotion`.
