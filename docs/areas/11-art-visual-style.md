# Area: Art & Visual Style

**Owner:** <unassigned> · **Depends on:** Core Platform & Build, Gameplay Engine
(drone type list, skyline table) · **Depended on by:** HUD & In-game UI, Economy &
Residents, Gameplay Engine, Main Menu, Highscores, Random Incidents

## 1. Purpose

This area defines the **look bible** for "One Ruble Per Drone" and owns the
**three.js presentation layer** (`src/render/three/`). It specifies the scene's colour
system, materials, models, lighting rig, post-processing chain, camera language, and
motion guidelines — the things that make the game read as a modern, cinematic 2026
console title while keeping the bright-surface / grim-premise contrast that is the
game's identity (GDD §2).

It also owns the **rendering contract**: the `ThreeView` façade, the arena↔world
coordinate mapping, the camera state machine, and the graceful no-WebGL fallback — so
no other area ever talks to `three` directly or has to reason about cameras.

> **Superseded:** the previous pixel-art pipeline (32-swatch frozen palette, sprite
> atlas, `SPRITE_IDS` registry, bitmap fonts, placeholder sprite provider, Canvas-2D
> `Renderer`) has been retired wholesale. If you are looking for `PALETTE`,
> `SpriteProvider`, or `assets.manifest.json`, they no longer exist.

## 2. Scope

### In scope
- The **scene colour system** (`three/theme.ts`), mirroring the CSS design tokens.
- **Models & materials**: the soldier, the gun, drone classes, the player's tower,
  the damageable Moscow skyline, projectiles and effects.
- The **lighting rig** and the day/night ramp.
- **Tone mapping and post-processing** (bloom, anti-aliasing, vignette, colour grade).
- The **camera language** — every pose the camera director can hold and how it moves
  between them.
- **Motion & animation** guidelines (timing, easing, damping).
- **Quality tiers**, the WebGL2 capability probe, context-loss handling, and the
  per-frame allocation/disposal discipline.
- **Incident visual treatments** (blackout, propaganda letterbox, pipe drips, …).

### Out of scope (owned elsewhere)
- DOM UI styling, layout, typography, and the CSS design tokens — **HUD & UI (10)**.
  This area mirrors those tokens into scene colours; it does not define them.
- Drone gameplay stats/behaviour — **Gameplay Engine** (we supply the visuals and
  agree the type list with them).
- Which HUD elements exist and where — **HUD & UI (10)**.
- Producing final, finished art assets — an art-production task. Everything here is
  authored **procedurally in code** today (see §3.3), so the game is always renderable
  and no area is ever blocked waiting on assets.

## 3. Requirements & mechanics

### 3.1 Aesthetic direction

- **Modern, cinematic, stylised.** Clean geometry, confident silhouettes, physically
  plausible lighting, filmic tone mapping, restrained bloom. The reference point is a
  contemporary console game's presentation — not photoreal, not retro.
- **The contrast is still the identity.** The surface stays bright, warm, and
  inviting: a sunny Moscow skyline, glinting onion domes, cheerful UI. The darkness
  lives in the writing and the situation, **never** in the rendering. A "you soiled
  yourself" crisis is presented in friendly game-show colours. Do not resolve the
  tension by making the game look grim.
- **Readability beats fidelity.** A diving drone must be unmistakable against the sky
  at a glance. Silhouette, value separation, and accent colour do that work; detail
  never gets in their way.
- **Depth is a storytelling tool.** Three deliberate depth layers — the rooftop post
  in the foreground, the player's cut-away tower behind it, the damageable skyline far
  beyond — make the stakes legible without a word of exposition.

### 3.2 Colour system

Scene colours live in `src/render/three/theme.ts` as a frozen record of named keys.
It **mirrors** the CSS custom properties in `src/ui/styles/tokens.css` (owned by area
10) so the 3D world and the DOM UI cannot drift apart.

Rules:

- **No colour literals outside `theme.ts`.** Scene code references named keys.
- Keys are **semantic, not literal** — `droneHostile`, `towerConcrete`, `skyDayTop`;
  never `blue2`. Renaming a hue must not require touching call sites.
- Colours are authored in **sRGB hex** and converted once at load. Lighting and
  exposure do the mood work; do not pre-darken a colour to fake night.
- **No fixed palette-size budget.** The old ≤32-swatch cap was a 16-bit-hardware
  constraint that no longer applies. Restraint is now a review concern, not a test.

The day and night ramps are the only colours the renderer interpolates between; every
other key is constant and reacts to light instead.

### 3.3 Models & materials

All geometry is **authored procedurally in code** from three.js primitives — no glTF
assets, no texture files, no loaders. This keeps the build asset-free and
dependency-light, keeps everything under version control as readable TypeScript, and
means the game is never in a half-rendered state waiting on an artist. Swapping in
authored models later is a `world.ts` change and nothing else.

Materials are `MeshStandardMaterial` with low roughness variance ("PBR-lite"): the
lighting rig carries the mood, materials just say what a thing is made of.

| Subject | Construction | Notes |
|---|---|---|
| Player's tower | Back + two side walls, per-storey floor slabs, emissive back-glow panel per floor | Deliberately **cut away** — the front face is omitted so the camera can drop inside. 32 storeys. |
| Roof deck | Capping slab + low parapet rails | The firing post. Its top face is the ground plane for the soldier (§3.4). |
| Residents | Simple capsule figures on occupied floors | Read as presence, not portraiture. |
| Moscow skyline | One tower per `content.combat.skyline.buildings` entry; a stack of slab meshes with an emissive window panel | `building.cut` hides slabs from the top — damage is literally geometry removed, repair restores it. |
| Drones | Faceted low-poly bodies, scaled by `drone.radius`, tinted by class | Constant idle tumble so they read as airborne. |
| Projectiles | Small emissive spheres | Pooled; see §3.9 for the muzzle-blend rule. |
| Gun | Barrel cylinder on a yaw pivot + emissive muzzle sphere | Barrel pivots at one end; the muzzle is the visible source of fire. |
| Soldier | §3.4 | — |
| Sky | Large inward-facing backdrop, tinted by the day/night ramp | Plus a sun/moon billboard tracking the cycle. |

**Pooling is mandatory.** Drone and projectile meshes are allocated once and hidden
when unused, never created per frame. Geometries and materials are shared across
instances of the same class.

### 3.4 The soldier (rooftop post)

The soldier is the emotional anchor of the frame and has hard placement requirements.

1. **He stands on the roof of the skyscraper he is operating from.** His feet rest on
   the **top face of the roof deck** — not floating above it, not sunk into it, not
   parked at an arbitrary height near the gun. The placement is derived from the deck
   geometry, so changing the deck thickness cannot desynchronise him from it.
2. **He is not parented to the gun.** He is a sibling of the gun on the roof, not a
   child of its pivot. A gun that pitches its barrel skyward must not tip the soldier
   with it. His **body yaw** follows the aim direction, damped and clamped to a
   plausible human range; his vertical axis stays vertical.
3. **He is a recognisable human figure**, not a placeholder solid: boots, legs,
   greatcoat torso, arms reaching to the gun grips, head, and the ushanka. He is
   sized **against the tower he stands on**, not against an assumed metre: 32 storeys
   of `STORY_H` make one world unit about 3.3 m, so a man is a little over half a
   unit (`SOLDIER_H`). Every proportion of the figure — and of the gun, the parapet,
   and the residents indoors — is a fraction of `SOLDIER_H`, so re-scaling the world
   is one edit. Sizing him in assumed metres is how the rooftop ended up with an
   eight-metre conscript.
4. **He is posed by state**, carrying over the four states the retired sprite set had:
   `idle` (settled, slow breathing), `fire` (braced, recoil kick), `tired` (slumped
   shoulders, head dipping — driven by the sleep meter), `crisis` (tense, jittery —
   driven by any meter in crisis). Transitions are damped, never snapped. Idle motion
   only ever settles his weight *downward*: nothing may lift his boots off the deck.
5. **He is always somewhere legible.** In interior mode he is *inside the building*
   on the floor being visited — he walked down there — and the rooftop post correctly
   shows an unattended gun. He is never simply switched invisible.
6. **The camera must show him.** The `shooting` pose is framed over his shoulder so
   he and the parapet anchor the foreground with the skyline beyond (§3.7). This is
   only possible because his tower sits **in front of** the action plane
   (`TOWER_Z > ACTION_Z`): the camera has to stand ~19 units back to frame a 34-unit
   arena, and a half-unit man at that range is a speck. Pulling his rooftop toward
   the lens is what buys him roughly a fifth of the frame height. Everything in play
   maps above the roofline, so the near tower never occludes the playfield.

### 3.5 Lighting & day/night

- **Rig:** one hemisphere light (sky/ground bounce) + one directional key light
  standing in for the sun. Ambient-only lighting flattens the towers and is not
  acceptable.
- **Day/night ramp:** a single `daylight ∈ [0,1]` value from `core/difficulty` drives
  *everything* — sky tint, hemisphere and key intensity, key colour temperature, the
  sun/moon billboard, and window emissive strength. One input, no independently
  drifting knobs.
- **Windows carry the night.** As daylight falls, window emissive rises; a night
  skyline should read as a field of warm lit windows, which is also the clearest
  possible feedback for how much of the city is still standing.
- **Shadows:** the key light casts shadows on the medium and high tiers only, from the
  rooftop post — the area the player actually looks at. The skyline does not
  self-shadow; it is too far away to earn the cost.
- **Exposure, not paint.** Mood comes from light intensity and tone mapping. Do not
  darken material colours to simulate night.

### 3.6 Tone mapping & post-processing

- **Output:** `ACESFilmicToneMapping` with `SRGBColorSpace` output. Exposure is a
  single tunable that the day/night ramp may nudge.
- **Chain** (`three/post.ts`, built on the addons bundled with `three`):
  `RenderPass` → bloom → SMAA → output. Bloom is **restrained** — it exists to make
  the muzzle flash, lit windows, and explosions feel hot, not to haze the frame.
- **Vignette and colour grade** are subtle and permanent; they unify the frame. They
  must never reduce the contrast between a drone and the sky.
- The whole chain is **skipped on the low tier** and whenever `reducedFlash` is set,
  falling back to a direct render. The game must look coherent, not broken, without it.

### 3.7 Camera language

All camera behaviour lives in **one state machine**, `three/camera-director.ts`. No
other module positions a camera. Poses are `{ eye, look, fov }` records produced by
pure functions, so framing is unit-testable without a GPU.

| State | Framing | Feel |
|---|---|---|
| `menu` | Slow orbit/crane around the player's tower, skyline behind | Alive, unhurried, attract-mode |
| `intro` | Starts low at the tower's ground floor, cranes up the cut-away to the roof | Establishes where you are and how far up |
| `shooting` | Over the soldier's shoulder; he and the parapet anchor the foreground, skyline mid-frame, sky above | The default play framing |
| `interior` | Drops down the cut-away to the floor being visited | Intimate, domestic — the opposite of the roof |
| `pause` | Holds the current pose, motion damped out | Calm, clearly suspended |

Transitions are **eased blends between poses**, never cuts. Blend rates are damped
per-second so they are frame-rate independent.

**Aiming is decoupled from framing.** A separate camera is pinned to the canonical
`shooting` pose and never moves; `screenToWorld` ray-casts through it against the
fixed action plane. The player's aim therefore stays exact while the render camera
cranes, blends, or sits inside the building. That pinned camera must be **derived
from the director's pose** — a hand-copied duplicate will silently drift out of sync
and break aiming.

### 3.8 Incident visual treatments

How the Random Incidents area's flags look. Scene-side treatments live in the three.js
layer; UI-side treatments are area 10's.

| Incident | Treatment |
|---|---|
| Blackout (electrical) | Window emissive to near-zero and key/hemisphere intensity down hard; the muzzle flash and drone accents become the only bright things. Reads as the city going dark, not as a black screen. |
| Propaganda broadcast | Cheerful letterbox bars + portrait in the **DOM layer** (area 10) — crisper as DOM than as geometry. |
| Pipe failure | Drip particles near the affected floor; a matching motif on the toilet affordance in the UI. |
| Supply shortage / inspection | A DOM banner (area 10); no scene change. |
| Air-raid siren / incoming wave | Warm pulse on the rooftop lighting, synchronised with the UI siren banner. |

Every treatment must respect **`reducedFlash`**: no strobing, no rapid luminance
swings. Substitute a steady state at the same readability.

### 3.9 Motion & animation

All animation is **code-driven** — there are no keyframed clips.

- **Damping, not lerping-by-frame.** Use a per-second damping factor
  (`k = 1 - exp(-rate * dt)`, or an equivalent clamped form) so behaviour is identical
  at 30 fps and 144 fps. A raw `x += (target - x) * 0.1` per frame is frame-rate
  dependent and is a bug.
- **Muzzle flash:** a short emissive pop (~50 ms) on each shot, plus a small recoil
  kick on the barrel that decays out.
- **Tracer reconciliation:** the simulation fires from a flat arena point, but the
  visible muzzle sits on the roof at the tower's depth. A projectile carries the
  muzzle offset at spawn and **sheds it linearly over its first stretch of travel**,
  so a shot leaves the barrel as a straight line and settles onto its true path far
  off-screen. Never snap a tracer back toward the post — it reads as a visual bug.
- **Drones:** constant slow tumble; vertical bob is procedural, never keyframed.
- **Skyline damage:** a slab disappearing is a *beat* — it earns a brief emphasis, not
  a silent pop.
- **Idle life:** the soldier breathes, the sun tracks, windows flicker faintly. A
  static frame is a dead frame.
- **`reducedMotion`** shortens or removes every non-essential tween — camera orbit,
  breathing, bob — while leaving gameplay-critical motion (drones, tracers) intact.

### 3.10 Quality tiers & robustness

| Tier | Post-processing | Shadows | Pixel ratio |
|---|---|---|---|
| High | Full chain | On | `min(dpr, 3)` |
| Medium | Bloom + SMAA | On, reduced map | `min(dpr, 2)` |
| Low | None | Off | `1` |

- Tier selection is automatic with a manual override in Settings; `reducedFlash`
  forces at most Medium.
- **Never trade simulation rate for visuals.** The fixed-timestep loop is untouchable;
  degrade the picture instead.
- **WebGL2 probe:** acquire the context directly and **silently** bail to a no-op view
  when it is unavailable, so the sim and the DOM UI keep running (`compatibility.md
  §2`). Letting `THREE.WebGLRenderer` acquire it logs a console error first, which
  fails the strict no-console-error smokes on WebGL-less CI engines.
- **Context loss** is handled, not ignored: stop rendering on `webglcontextlost`,
  rebuild on `webglcontextrestored`.
- **Disposal:** `dispose()` releases geometries, materials, render targets, and the
  post chain.

## 4. Public interface (TypeScript)

```ts
// src/render/three/theme.ts — named scene colours, mirroring src/ui/styles/tokens.css
export const THEME = Object.freeze({
  skyDayTop: '#4fc3ff', skyNightTop: '#1b1f5c',
  towerConcrete: '#9aa0b5', windowLit: '#ffe066',
  uniform: '#6e7d3b', skin: '#f2c79a', gunmetal: '#5a6172',
  flash: '#fff3b0', flashHot: '#ff9f1c',
  droneScout: '#5ad1ff', droneBomber: '#ff5d5d', droneSwarm: '#b06cff', droneBoss: '#ff2e63',
  /* … */
} as const);
export type ThemeKey = keyof typeof THEME;

// src/render/three/mapping.ts — PURE. No `three` import, so it is node-testable.
export const ARENA_W = 384;
export const ARENA_H = 216;
/** Arena x → world x. */        export function ax(x: number): number;
/** Arena y → world y (arena y is down, world y is up). */
                                  export function ay(y: number): number;
/** World (x,y) on the action plane → arena coordinate. Exact inverse of ax/ay. */
export function toArena(worldX: number, worldY: number): Vec2;
/** The rooftop surface the soldier stands on, derived from the deck slab. */
export const ROOF_DECK_TOP_Y: number;
/** The arena's world extents — what the shooting camera has to cover. */
export const ARENA_TOP_Y: number, ARENA_BOTTOM_Y: number, ARENA_MID_Y: number, ARENA_HALF_W: number;

// src/render/three/camera-director.ts — the ONLY owner of camera poses.
export type CameraState = 'menu' | 'intro' | 'shooting' | 'interior' | 'pause';
export interface CameraPose { eye: Vec3; look: Vec3; fov: number; }
/** PURE: the resting pose for a state. */
export function poseFor(state: CameraState, ctx: PoseContext): CameraPose;
/** PURE: linear blend between two poses. */
export function blendPose(a: CameraPose, b: CameraPose, t: number): CameraPose;
/** PURE: frame-rate-independent damping, `1 - exp(-rate * dt)`. */
export function damping(rate: number, dt: number): number;
export interface CameraDirector {
  readonly state: CameraState;
  readonly pose: CameraPose;
  /** The canonical, never-moving `shooting` pose the aim raycast uses. */
  readonly aimPose: CameraPose;
  /** Request a state; the director eases into it unless told to cut. */
  setState(state: CameraState, opts?: { immediate?: boolean }): void;
  update(dt: number, ctx: PoseContext): void;
}

// src/render/three/soldier.ts — the figure, and the maths that poses him.
/** Total height, boots to ushanka. Every proportion is a fraction of this. */
export const SOLDIER_H: number;
/** How far his torso may twist to follow the aim. He cannot spin with the barrel. */
export const BODY_YAW_LIMIT: number;
export type SoldierPose = 'idle' | 'fire' | 'tired' | 'crisis';
export function soldierPoseFrom(mood: SoldierMood): SoldierPose;   // PURE
export function targetsFor(pose: SoldierPose): SoldierPoseTargets;  // PURE
export function bodyYawFor(aimAngle: number): number;               // PURE, clamped
export interface Soldier {
  /** Added to the SCENE, never to the gun. Origin is the sole of his boots. */
  readonly group: THREE.Group;
  readonly height: number;
  update(u: SoldierUpdate): void;
  dispose(): void;
}

// src/render/three/view.ts — the façade every other area talks to.
export interface ThreeView {
  resize(cssW: number, cssH: number): void;
  /** Canvas-relative pixel → arena coordinate, via the fixed aim camera. */
  screenToWorld(canvasX: number, canvasY: number): Vec2;
  render(gs: GameState, alpha: number, vs: PlayingViewState): void;
  setCameraState(state: CameraState): void;
  startIntro(): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}
/** Returns a silent no-op view when WebGL2 is unavailable. Never throws. */
export function createThreeView(canvas: HTMLCanvasElement, content: Content): ThreeView;
```

## 5. Data / content tables

This area defines **no content tables** and ships **no asset files**. It consumes:

- `content.combat.skyline` — building positions, widths, heights, storey counts.
- `content.combat.gun.pivot` — the arena-space firing column.
- `content.economy.roster` — resident floors, for the tower's occupied interiors.
- `content.drones` — the drone class list, for accent colours.

Geometry and colour live in code (`three/world.ts`, `three/theme.ts`). There is no
manifest, no atlas, and no `SpriteId` registry — all retired.

## 6. Persistence

**None** written by this area. It **consumes** the accessibility flags owned by
Settings/Persistence (`Settings.accessibility`, 09 §5): `reducedFlash` (suppresses
flashing and forces a lower quality tier) and `reducedMotion` (shortens or removes
non-essential tweens). If absent, default to flashing/motion **on**.

## 7. Dependencies & integration

- **Core Platform** owns `main.ts`, which constructs the view and drives `resize()`.
- **Gameplay Engine** owns `Playing`, which calls `render(gs, alpha, vs)` each frame
  and supplies the `PlayingViewState` view model.
- **HUD & UI (10)** owns the design tokens this area mirrors, and drives
  `setCameraState` for the menu/pause backdrop.
- **Random Incidents** sets the flags the treatments in §3.8 react to.
- Emits **no events**; it is a pure consumer of state.

**The hard rule:** this area **never mutates `GameState`**. It reads state and draws.
Any frame-to-frame value it needs (animation phase, damping) is renderer-local and
must not feed back into the simulation — that is what keeps the determinism goldens
valid.

## 8. Required automated tests (MUST pass)

Per architecture.md §7 — `tsc --noEmit`, ESLint, and `vitest run` must all be green.
The testable surface here is the **pure** math; WebGL itself is smoke-tested in the
Playwright matrix, not unit-tested.

1. **Arena↔world round-trip:** for a grid of arena points spanning the play area,
   `toArena(ax(p.x), ay(p.y))` returns `p` within floating-point tolerance. This is
   the test that catches a broken aim mapping.
2. **Mapping anchors:** the firing post maps to the roof height, and arena x-centre
   maps to world x-origin — pinning the two anchors the whole scene hangs off.
3. **Camera poses are total:** `poseFor` returns a finite, well-formed pose for every
   `CameraState` — no NaN, no zero `fov`, eye never coincident with look.
4. **Pose blending:** `blendPose(a, b, 0) === a`, `blendPose(a, b, 1) === b`, and
   intermediate values are bounded by the endpoints per component.
5. **Director transitions:** `setState` eases rather than snaps (the pose after one
   small `update` is strictly between the old and new poses); `startIntro` restarts
   the crane from the beginning.
6. **Aim pose is stable:** `aimPose` is unchanged after the director has been driven
   through `menu`, `interior`, and `pause` — the guarantee that aiming cannot drift.
7. **The shooting frustum covers the whole arena.** All four arena corners on the
   action plane are inside a real `PerspectiveCamera` built from the `shooting` pose
   at 16:9. Tightening the framing for looks must never make part of the playfield
   unaimable.
8. **Soldier placement:** the soldier's feet sit on the roof-deck top face (computed
   from the deck geometry, not a literal) in every pose at every point in the idle
   cycle, and his transform does **not** inherit the gun's barrel rotation — his yaw
   is clamped to `BODY_YAW_LIMIT` for any aim angle whatsoever.
9. **Damping is frame-rate independent:** stepping the damping helper once with `dt`
   and twice with `dt/2` converge within tolerance.
10. **Theme integrity:** `Object.isFrozen(THEME)`; every value matches
    `/^#[0-9a-f]{6}$/i`.
11. **No-WebGL fallback:** `createThreeView` with a canvas whose `getContext` returns
    `null` yields a working no-op view — every method callable, nothing thrown,
    **nothing logged to the console**.

## 9. Acceptance criteria / Definition of done

On top of the global DoD (architecture.md §9):
- [ ] `THEME` exported and frozen; no colour literals elsewhere in `render/three/`.
- [ ] Theme keys and the CSS tokens in `src/ui/styles/tokens.css` agree.
- [ ] `camera-director.ts` is the sole owner of camera poses; no pose math anywhere
      else, including `view.ts`.
- [ ] The aim camera is derived from the director's canonical `shooting` pose and
      never moves.
- [ ] **The soldier stands on the roof deck of his own tower**, feet on its top face,
      un-parented from the gun, posed by meter state, and clearly framed by the
      `shooting` camera.
- [ ] Day/night is driven by the single `daylight` value; tone mapping and the post
      chain are in place and skipped correctly on the low tier / `reducedFlash`.
- [ ] No per-frame allocations in the render loop; drone and projectile meshes are
      pooled; `dispose()` releases everything.
- [ ] Missing WebGL2 degrades silently to the no-op view with the DOM UI fully usable.
- [ ] All §8 tests authored and passing; `npm run check` green.

## 10. Open questions / risks

- **Aim/framing coupling is the sharpest risk in this area.** Re-framing the
  `shooting` camera without re-deriving the aim camera silently misaligns every shot,
  and nothing but test §8.1/§8.6 will catch it. Never duplicate the pose by hand.
- **Procedural geometry has a ceiling.** Code-authored primitives will carry the game
  a long way, but a genuinely bespoke soldier or drone silhouette eventually wants an
  authored model. The `world.ts` seam keeps that a contained change; adding a loader
  is a lead decision (new asset pipeline, new bundle cost).
- **Mobile fill rate.** Bloom at high DPR is the most likely mobile regression. The
  tier system is the mitigation; the §7 perf budget in `compatibility.md` is the gate.
- **Emoji variance — accepted, not resolved.** Status icons are system emoji in the
  DOM layer and legitimately differ per platform (`compatibility.md §2`). Screenshot
  assertions must mask them.
- **Drone roster churn:** a new drone class needs an accent colour and a silhouette;
  the class→colour mapping is the single place to update.
- **Reduced-motion semantics — RESOLVED:** the persisted flags are `reducedFlash` /
  `reducedMotion` (`Settings.accessibility`, docs/areas/09 §5).
