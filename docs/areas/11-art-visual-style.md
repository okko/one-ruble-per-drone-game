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
- Producing final, finished art assets — an art-production task. Geometry is authored
  **procedurally in code**; surfaces are **generated at build time** by a script in
  this repo (see §3.3). Nothing is hand-authored in a DCC tool, so the game is always
  renderable and no area is ever blocked waiting on assets.

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

### 3.3 Models, materials & the asset pipeline

**Geometry is authored procedurally in code** from three.js primitives. **Surfaces are
generated at build time** by `scripts/gen-assets.mjs` into `public/gen/`, from the pure
generators in `src/render/three/texgen.ts`.

The build-time split is the important part and it was a deliberate reversal of an
earlier "no texture files at all" rule. Generating maps in the browser costs the player
a main-thread stall on first load; generating them in a DCC tool costs a human and a
binary blob nobody can review. Generating them from **reviewable, tested TypeScript at
build time** costs neither: the recipe is source, the output is deterministic from a
seed, and the runtime just fetches PNGs.

Rules that keep this honest:

- **No runtime texture synthesis.** Nothing generates surface pixels in the render loop
  or at boot. (The one 32×32 particle dot in `particles.ts` is a shader input, not a
  surface, and is exempt.)
- **No image library and no three.js addons.** `scripts/png.mjs` is a dependency-free
  PNG encoder in this repo, unit-tested against an independent decoder. `three/examples`
  is off limits, which is why the geometry merge in `drones.ts` and the Kremlin star in
  `city.ts` are hand-rolled.
- **The asset set is budgeted and the budget is enforced.** `BUDGET_BYTES` fails the
  build if the generated set exceeds it. It is 320 kB; the set is 47 kB.
- **Textures are progressive enhancement.** `assets.ts` loads them after first paint and
  applies them when they arrive. A missing, failed, or stale-version manifest is not an
  error — the scene keeps its untextured materials. The low tier never requests them.
- **The manifest is versioned.** `EXPECTED_VERSION` must match or the assets are
  ignored, so a stale `public/gen/` from an old checkout cannot mis-tile a facade.

Materials are `MeshStandardMaterial` with low roughness variance ("PBR-lite"). One hard
constraint: **`metalness` stays at or below ~0.45 everywhere.** A near-1 metal has
almost no diffuse term and needs an environment map to have anything to reflect; the low
tier has none, so a "correct" metal renders black. Metals are faked with a lighter base
colour instead.

| Subject | Construction | Notes |
|---|---|---|
| Player's tower | Back + two side walls, per-storey floor slabs, emissive back-glow panel per floor | Deliberately **cut away** — the front face is omitted so the camera can drop inside. 32 storeys. |
| Roof deck | Capping slab + low parapet rails | The firing post. Its top face is the ground plane for the soldier (§3.4). |
| Rooftop props | Instanced sandbag emplacement, crates, spent brass, radio + antenna | `rooftop.ts`. Two instanced meshes carry the lot. |
| Residents | Simple capsule figures on occupied floors | Read as presence, not portraiture. |
| Moscow skyline | **Derived** from `content.combat.skyline`: setbacks, cornices, crowns (dome / spire / Kremlin star), rooftop clutter | `city-layout.ts` is pure and computes the massing; `city.ts` draws it. One `InstancedMesh` per building for the facade, plus shared zone meshes for trim, domes, spires, stars and clutter. |
| Skyline damage | `InstancedMesh.count` | Boxes are ordered by the storey they die with, so damage is a **count**, not a rebuild. Repair restores it. |
| Drones | Six built silhouettes — quadcopter, hexacopter, delta wing, spiked octahedron, eight-rotor boss, bird | `drones.ts`. Bodies are pooled meshes; every rotor disc in the sky is one shared `InstancedMesh`. |
| Explosions & impacts | Two point clouds (additive debris, normal-blended smoke) + a shockwave ring `InstancedMesh` | `vfx.ts` (pure simulation) + `particles.ts` (GL). Fixed slabs, round-robin overwrite, zero allocation per frame. |
| Projectiles | Small emissive spheres | Pooled; see §3.9 for the muzzle-blend rule. |
| Gun | Jacketed barrel, muzzle brake, ammo can, belt of instanced brass, spade grips, tripod | `weapon.ts`. Recoil is a **damped spring solved analytically** in `recoil.ts`, kicked once per shot. |
| Soldier | §3.4 | — |
| Sky | Inward-facing gradient dome with a sun/moon disc, driven by the day cycle | `sky.ts`. **Must not** use `depthWrite: false`, `renderOrder = -1`, or `frustumCulled = false` — all three were measured as a large software-rasteriser overdraw regression on CI. |

**Pooling is mandatory.** Drone, projectile and particle storage is allocated once and
hidden or truncated when unused, never created per frame. Geometries and materials are
shared across instances of the same class.

**Module map.** The renderer is split so that everything provable is pure and free of
`three`, and the untestable GL layer is as thin as it can be made:

| Pure (unit-tested; in the coverage and mutation gates) | GL (Playwright-smoked only) |
|---|---|
| `mapping.ts` — arena↔world | `view.ts` — the façade and the frame |
| `camera-director.ts` — poses | `sky.ts`, `lighting.ts`, `post.ts` |
| `theme.ts` — colours | `city.ts`, `rooftop.ts`, `weapon.ts` |
| `quality.ts` — tier policy | `drones.ts`, `particles.ts` |
| `texgen.ts` — surface generation | `assets.ts` — loading |
| `city-layout.ts` — massing | `soldier.ts` (its maths is pure and gated) |
| `recoil.ts` — the spring | |
| `vfx.ts` — particles & shockwaves | |

**Drone deaths are inferred, not announced.** The simulation emits no explosion event;
a drone simply leaves the list — and it leaves for two reasons, shot down or arrived and
detonated. From the roof both are explosions, so `view.ts` diffs the drawn set frame to
frame and explodes whatever went missing. It stores its **own copy** of the position,
never the sim's object, which is recycled.

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

The tier is a **policy record**, not a scattering of `if (tier === 'low')`. `quality.ts`
owns `TierPolicy` and is pure and unit-tested; every consumer reads a flag off it.

| Flag | High | Medium | Low |
|---|---|---|---|
| `post` | full chain | bloom only | off |
| `bloom` / `ambientOcclusion` / `antialias` | on | bloom + AA | off |
| `shadows` (rooftop only) | on | on | off |
| `shadowMapSize` | 2048 | 1024 | — |
| `environment` (generated IBL) | on | on | off |
| `richSky` (`#ifdef RICH_SKY` branch) | on | on | off |
| `detailTextures` (fetch `public/gen/`) | on | on | off |
| `pixelRatioCap` | 3 | 2 | 1 |

- Tier selection is **automatic at boot**, with an adaptive downgrade if frame time
  runs long. There is no persisted setting and no Settings control; `reducedFlash`
  forces at most Medium.
- **Never trade simulation rate for visuals.** The fixed-timestep loop is untouchable;
  degrade the picture instead.
- **WebGL2 probe:** acquire the context directly and **silently** bail to a no-op view
  when it is unavailable, so the sim and the DOM UI keep running (`compatibility.md
  §2`). Letting `THREE.WebGLRenderer` acquire it logs a console error first, which
  fails the strict no-console-error smokes on WebGL-less CI engines.
- **Context loss** is handled, not ignored: stop rendering on `webglcontextlost`,
  rebuild on `webglcontextrestored`.
- **Disposal:** `dispose()` releases geometries, materials, textures, render targets,
  and the post chain.
- **The post chain is a lazy chunk.** It is `import()`ed only when the tier affords it,
  so the low tier never downloads it.

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

// src/render/three/quality.ts — PURE. The tier is a policy record, not scattered ifs.
export type QualityTier = 'high' | 'medium' | 'low';
export interface TierPolicy {
  post: boolean; bloom: boolean; ambientOcclusion: boolean; antialias: boolean;
  shadows: boolean; shadowMapSize: number;
  environment: boolean; richSky: boolean; detailTextures: boolean;
  pixelRatioCap: number;
}
export function policyFor(tier: QualityTier): TierPolicy;

// src/render/three/texgen.ts — PURE. No `three`, no DOM: it returns plain byte arrays,
// which is what lets the build script run it under node and the tests assert on it.
export interface Bitmap { width: number; height: number; data: Uint8ClampedArray; }
export interface SurfaceMaps { albedo: Bitmap; normal: Bitmap; roughness: Bitmap; }
/** Value noise that TILES: the only kind usable on a repeating facade. */
export function tilingValueNoise(size: number, frequency: number, seed: number): Float32Array;
export function tilingFbm(size: number, octaves: number, seed: number): Float32Array;
export function heightToNormal(height: Float32Array, size: number, strength: number): Bitmap;
export function concrete(size: number, seed: number): SurfaceMaps;
export function windowGrid(options: WindowGridOptions): Bitmap;

// src/render/three/assets.ts — progressive enhancement. Never throws, never blocks.
export const EXPECTED_VERSION: number;
/** Resolves when (and if) the generated set is available. Missing assets are not an error. */
export function loadDetail(policy: TierPolicy): Promise<DetailAssets | null>;

// src/render/three/city-layout.ts — PURE. The massing of the skyline, derived.
export type CrownKind = 'none' | 'dome' | 'spire' | 'star';
export interface CityBox { x: number; y: number; w: number; h: number; d: number; diesAt: number; }
export interface CityLayout { boxes: CityBox[]; crown: CityCrown; }
/** Deterministic from the building's id, so a layout never changes between runs. */
export function cityLayoutFor(id: string, width: number, height: number, storeys: number): CityLayout;
/** How many boxes survive `surviving` storeys — damage is a COUNT, not a rebuild. */
export function boxesAlive(boxes: readonly CityBox[], surviving: number): number;

// src/render/three/recoil.ts — PURE. A damped spring, solved, not stepped.
export interface RecoilState { offset: number; velocity: number; flash: number; shots: number; }
export function createRecoil(): RecoilState;
/** One shot fired. Called on the per-shot EDGE, never while `firing` is true. */
export function kickRecoil(state: RecoilState): void;
/** Exact analytic solution. Stepping this integrator made the kick frame-rate dependent. */
export function advanceRecoil(state: RecoilState, dt: number): void;

// src/render/three/vfx.ts — PURE. Fixed slabs, round-robin overwrite, no allocation.
export const SPARK: number, SMOKE: number, EMBER: number;
export interface ParticleField { /* parallel Float32Array slabs + alive/kind flags */ }
export function createField(capacity: number): ParticleField;
export function emitBurst(field: ParticleField, options: BurstOptions): number;
export function advanceField(field: ParticleField, dt: number, gravity: number): void;
/** 1 at birth falling to 0 at death; rides in the vertex colour, so one material fades many. */
export function fadeOf(field: ParticleField, i: number): number;
export function createRings(capacity: number): RingField;
export function emitRing(rings: RingField, x: number, y: number, z: number, reach: number, life: number): void;
export function ringRadius(rings: RingField, i: number): number;  // eased OUT: a wave snaps
export function ringFade(rings: RingField, i: number): number;

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

This area defines **no content tables**. It ships **no hand-authored asset files**; the
files in `public/gen/` are build outputs, reproducible from source by `npm run
gen-assets` and never edited by hand. It consumes:

- `content.combat.skyline` — building positions, widths, heights, storey counts. The
  city's massing (setbacks, cornices, crowns, clutter) is **derived** from these; the
  balance table is unchanged and the silhouette is a pure function of it.
- `content.combat.gun.pivot` — the arena-space firing column.
- `content.economy.roster` — resident floors, for the tower's occupied interiors.
- `content.drones` — the drone class list, for silhouettes and accent colours.

Geometry and colour live in code. There is no atlas and no `SpriteId` registry — both
retired. The generated texture set has a **versioned manifest**; see §3.3.

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
12. **Generated surfaces tile.** A texture that seams is worse than no texture, so the
    noise tests assert on **scale-free** metrics — excess variance across the wrap edge
    relative to the interior, and sign reversals per row — never on absolute pixel
    values, which move whenever the generator is tuned.
13. **The PNG encoder round-trips.** Every filter type it emits is decoded by an
    independent decoder in the test and compared to the source bitmap. Filter numbering
    is the trap: 3 is Average and 4 is Paeth, and only a real decoder catches a swap.
14. **City damage is a count.** `boxesAlive` is monotonic in surviving storeys, returns
    0 for a levelled building and every box for an untouched one; a layout is a pure
    function of the building id.
15. **Recoil is frame-rate independent.** Advancing the spring once by `dt` and twice by
    `dt/2` agree to 9 decimals, and a 2-second gap does not destabilise it.
16. **The particle field never grows and never allocates.** Emitting past capacity
    overwrites rather than extends, the backing arrays are identity-stable across a
    burst, and every particle retires within `life * 1.4`. Smoke rises; sparks fall.
17. **Render cost is bounded** (Playwright, `compatibility.md §7`): draw calls and
    geometry count stay under their ceilings, and the scene graph does not grow with
    elapsed time.

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
- [ ] No per-frame allocations in the render loop; drone, projectile and particle
      storage is pooled; `dispose()` releases everything.
- [ ] Every pure module here is listed in `vitest.config.ts` `coverage.include` **and**
      `stryker.conf.json` `mutate`. A pure module outside the gates is untested by
      default, whatever its line coverage happens to say.
- [ ] The generated asset set is under `BUDGET_BYTES` and the build fails if it is not.
- [ ] Missing WebGL2 degrades silently to the no-op view with the DOM UI fully usable.
- [ ] Missing or stale generated assets degrade silently to untextured materials.
- [ ] All §8 tests authored and passing; `npm run check` green.

## 10. Open questions / risks

- **Aim/framing coupling is the sharpest risk in this area.** Re-framing the
  `shooting` camera without re-deriving the aim camera silently misaligns every shot,
  and nothing but test §8.1/§8.6 will catch it. Never duplicate the pose by hand.
- **Procedural geometry has a ceiling — partly RESOLVED.** Surfaces now come from a
  build-time generator, which removed the flattest-looking half of the problem. Genuinely
  bespoke silhouettes still want an authored model, and adding a **runtime** loader
  remains a lead decision (new dependency, new bundle cost). The build-time seam is the
  cheaper place to extend.
- **The soldier is deliberately untouched.** `soldier.ts` is at 100% coverage and is
  mutation-tested; its detail pass is a change of its own and must not ride along with a
  scene-wide one.
- **Mobile fill rate.** Bloom at high DPR is the most likely mobile regression. The
  tier system is the mitigation; the §7 perf budget in `compatibility.md` is the gate.
- **Emoji variance — accepted, not resolved.** Status icons are system emoji in the
  DOM layer and legitimately differ per platform (`compatibility.md §2`). Screenshot
  assertions must mask them.
- **Drone roster churn:** a new drone class needs an accent colour and a silhouette;
  the class→colour mapping is the single place to update.
- **Reduced-motion semantics — RESOLVED:** the persisted flags are `reducedFlash` /
  `reducedMotion` (`Settings.accessibility`, docs/areas/09 §5).
