# Cross-Browser & Mobile Compatibility

> Status: **Foundation doc (mandatory).** Defines the browser support floor, the
> mobile/touch control scheme, the iOS-Safari requirements, and the cross-browser
> test matrix. Read alongside `architecture.md`, `testing.md`, and the area docs it
> references. Any area that **renders, takes input, plays audio, or persists** must
> satisfy its row in §9.

## 1. Support matrix

The game ships as static files and must play well on touch **and** desktop.

| Class | Targets (support floor) |
|---|---|
| Desktop | Last 2 versions of Chrome, Edge, Firefox, **Safari** |
| iOS / iPadOS | **Safari 15.4+** (mobile is a first-class target) |
| Android | Chrome (last 2), Samsung Internet (last 2) |

The 15.4+ floor is deliberate: it lets us rely on **Pointer Events**, the dynamic
viewport units (`dvh`/`svh`/`lvh`), CSS custom properties, and **WebGL2** without
polyfills. Anything below the floor may degrade but is not gated.

## 2. Rendering (WebGL2) & the UI layer

The game draws its world with **three.js over WebGL2** at the device's native
resolution, and paints all chrome as **DOM over the top**. There is no Canvas-2D
renderer, no sprite atlas, and no fixed pixel-art backing buffer.

- **WebGL2 is required for the 3D world, not for the game.** `createThreeView` probes
  `canvas.getContext('webgl2')` itself and returns a **no-op view** when it is
  unavailable, so the simulation and the entire DOM UI keep running over a CSS gradient
  backdrop. The probe must stay **silent**: letting `THREE.WebGLRenderer` create the
  context logs `console.error` before it throws, which trips the strict
  no-console-error smokes on headless engines that ship WebGL disabled (CI Firefox runs
  with `AllowWebgl2:false`). Acquire the context first, then pass it to the renderer.
- **Device-pixel-ratio is capped.** `renderer.setPixelRatio(Math.min(devicePixelRatio, 3))`.
  Uncapped DPR on a modern phone is a fill-rate and VRAM trap; the cap is the mobile
  safety valve that the old "never allocate a device-pixel canvas" rule used to provide.
- **Quality tiers.** Post-processing (bloom, SMAA, vignette, colour grade), shadow
  resolution, and geometry detail are selected by tier. The low tier drops the post
  chain entirely. Tiers are also forced down by the `reducedFlash` accessibility
  setting. See `11-art-visual-style.md`.
- **Context loss.** Handle `webglcontextlost` (preventDefault, stop rendering) and
  `webglcontextrestored` (rebuild the scene). iOS discards contexts aggressively under
  memory pressure; a lost context must not take the UI down with it.
- **UI text is DOM at native resolution.** No canvas text measurement, no bitmap font,
  no pixel snapping. Fonts come from a system stack so there is no web-font load cost
  or FOUT.
- **System emoji are permitted in the DOM UI layer.** The former ban existed because
  color emoji drawn through canvas `fillText` blurred at 384×216 and varied across
  platforms. In a DOM layer at native resolution neither applies, so the meter and
  status indicators (😴 💩 🍞 💧 🚬 ₽) render as real emoji through the documented font
  stack (`"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"`) and a shared
  `.icon` class that fixes size and baseline. Per-engine glyph artwork **will** differ;
  that variance is accepted, and any screenshot assertion covering an emoji must mask
  it rather than pin it.

## 3. Viewport, orientation, and safe areas

- **Sizing source.** Drive `ThreeView.resize()` from **`window.visualViewport`**
  (width/height) when present, falling back to `window.innerWidth/innerHeight`. Listen
  to `visualViewport` `resize`, `orientationchange`, and `resize` (debounced) so the
  iOS Safari URL-bar show/hide reflow is handled instead of leaving the WebGL canvas
  mis-sized. The DOM UI reflows on its own via CSS.
- **CSS height.** Use **`100dvh`** with a `100vh` fallback so the iOS toolbar does not
  crop the game. Set the viewport meta to `viewport-fit=cover` and pad the UI layer
  with `env(safe-area-inset-*)` so nothing important sits under the notch or home
  indicator.
- **Orientation.** The game is 16:9 **landscape**. On a portrait phone, show a
  cheerful **"rotate to landscape" overlay** rather than a cramped strip.
  The Screen Orientation **lock** API is unsupported on iOS Safari — we *prompt*, we
  cannot force.
- **Fullscreen.** Unavailable on iPhone Safari. Do **not** depend on it; offer a
  fullscreen toggle only where the API exists.

## 4. Input & the touch control scheme

**Standardize on Pointer Events** (`pointerdown` / `pointermove` / `pointerup` /
`pointercancel`) as the single input source. Pointer Events unify mouse, touch, and
pen across the whole support floor, so there is no separate "mouse path" and "touch
path." Mouse- and Touch-specific listeners are avoided.

**Chosen control scheme — touch-to-aim, hold to fire:**

- **Touch:** a `pointerdown` in the play area sets the gun's aim to that world point
  and **starts continuous fire**; `pointermove` updates the aim; `pointerup` stops
  firing. Only the **primary pointer** aims/fires; secondary pointers are ignored (or
  routed to the on-screen intercom button — §9, HUD).
- **`pointercancel` must be handled as a fire-up.** iOS fires it when a gesture is
  interrupted (incoming call, notification, system gesture). If we don't treat it as
  fire-up, the gun sticks firing. This is a required test case.
- **Desktop (retained):** mouse move aims (hover), mouse button held fires; the
  keyboard fallback (A/D rotate the barrel, Space fires) remains fully playable.
- The existing overheat / jam firing model is driven by the **same** fire-down/up
  signals — there is no separate mobile firing code path.

**Gesture hygiene (CSS + handlers):** `touch-action: none`, `user-select: none`,
`-webkit-user-select: none`, `-webkit-touch-callout: none`, and `preventDefault` on
pointer events to suppress scrolling, double-tap-zoom, pull-to-refresh, and the
long-press selection callout. Applied to `html`/`body`, the WebGL canvas, and the UI
root. Reuse the existing `InputEvent` union — **extend, don't replace.**

**The UI layer must not swallow aim input.** `#ui` is `pointer-events: none` by default;
only interactive panels opt back in. A full-screen transparent overlay that eats
`pointerdown` is an aiming bug, and a required test case.

**Pointer→world mapping:** compute canvas-relative coordinates from
`getBoundingClientRect()` + `clientX/clientY` (not `offsetX/offsetY`, which differ
across browsers), then convert to arena space via `ThreeView.screenToWorld`, which
ray-casts against the fixed `z = 0` action plane using a camera pinned to the canonical
`shooting` pose. That camera never moves, so aim stays exact while the render camera
cranes and blends.

## 5. Audio unlock & backgrounding (iOS)

- `WebAudioBackend` constructs via `AudioContext ?? webkitAudioContext`.
- The context starts **suspended**; `resume()` must be called **synchronously inside
  the first user-gesture handler** (`pointerdown`/`keydown`/`touchend`) — iOS will not
  unlock from a deferred/async callback. The existing Core input unlock hook wires
  this; this doc fixes the gesture types and the synchronous requirement.
- **Backgrounding.** iOS suspends the context when the tab/app goes to the background.
  On `visibilitychange` (hidden) **auto-pause the game**; on visible again, call
  `resume()` before unpausing. Also handle `pagehide`.

## 6. Persistence (Safari specifics)

- **Private Mode.** iOS Safari Private Mode throws `QuotaExceededError` on the first
  **`setItem`**, not at construction. The storage wrapper must catch **at write time**
  and transparently switch to the in-memory backend; the game keeps running, data just
  doesn't persist. (See `09-state-and-persistence.md` — required test #12 is extended
  to cover "throws on first write after a clean construction.")
- **ITP eviction.** Safari may evict `localStorage` after ~7 days of no interaction;
  highscores/settings can vanish. Acceptable for a single-player browser game —
  documented as a known limitation, not worked around.

## 7. Mobile performance budget

The booted `Playing` scene must hold a frame-time budget on an emulated mid-tier
mobile (Playwright CPU throttling) with a representative drone count, running N seconds
without errors or unbounded growth. For the 3D renderer that means, per frame:

- **No allocations in the render loop.** Geometry, materials, `THREE.Vector3`/`Color`
  scratch objects, and the drone/projectile meshes are created once and pooled or
  reused. Allocating a `new THREE.Color()` per frame is a regression.
- **Bounded draw calls.** Share geometries and materials; the scene-graph size is a
  function of the content tables, not of elapsed time.
- **The ceilings are enforced, not advisory.** `tests/e2e/render-cost.spec.ts` reads
  `window.__render.stats` mid-run and fails the build if the scene exceeds:

  | Metric | Ceiling | Measured (high tier, mid-combat) |
  |---|---|---|
  | Draw calls | 400 | ~110 |
  | Geometries | 200 | ~134 |

  These are **ratchets**. They started at 2000/600 and came down as instancing landed;
  they may be raised only with a measurement and a reason in the commit message. The
  gap between measured and ceiling is deliberate headroom for a busy wave, not slack to
  be spent.
- **Instancing is how the ceilings are met**, not culling. One `InstancedMesh` per
  skyline building's facade, one for every rotor disc in the sky, one for the shockwave
  rings, and one point cloud each for hot debris and smoke. Damage and lifetime are
  expressed as `.count`, which costs nothing.
- **Dispose on teardown.** `ThreeView.dispose()` releases geometries, materials,
  textures, render targets, and the post-processing chain.
- **Tier down, don't drop frames.** On a low tier, disable post-processing and shadows
  rather than reducing the simulation rate — the fixed-timestep loop is never traded
  away for visuals.
- **No screenshot gate on the 3D scene** (§8). GPU rasterisation differs per engine and
  a pixel diff of a lit scene is a flake generator; cost and structure are asserted
  instead.

## 8. The cross-browser test matrix (mandatory)

`@playwright/test` runs as a **required CI gate** (replacing the old "optional smoke
test"), across **Chromium, WebKit (Safari engine), Firefox, and an emulated iPhone
(WebKit) viewport**. Minimum suite:

1. Boots to MainMenu without console errors on every engine — **including engines with
   WebGL disabled**, where the no-op view path must stay silent and the DOM UI usable.
   *(Covered: the GL-denied case patches `getContext` before app code runs, then starts a
   run and reads the HUD, proving the sim is playable renderer-less and says nothing.)*
2. Starts a run; a tap/click in the sky aims + fires and destroys a drone (covers the
   §4 control scheme and `pointercancel` → cease-fire). The closed-loop aim smoke is bounded
   by wall clock rather than iteration count, so parallel load cannot fail a genuine pass.
3. Audio context reaches `running` after the first gesture (§5). That gesture is a **menu
   button**, not the canvas: the menu is modal, so unlock must not depend on reaching the world.
4. `localStorage` round-trips, and the in-memory fallback path works when storage
   throws (§6).
5. Mobile-viewport run holds the §7 frame-time budget under CPU throttling.
6. The DOM UI is present and navigable: `#ui` mounts, keyboard navigation moves the
   menu selection, and interactive panels receive pointer events while the rest of the
   layer stays click-through. *(Covered: `aria-selected` follows the arrow keys, and a
   hit test in the sky mid-run must land on `#game3d`.)*

**No screenshot snapshots of the 3D scene.** A WebGL frame is not reproducible across
engines, drivers, or GPUs; pinning one would be a flaky gate that teaches agents to
re-baseline. Assert on DOM structure, text, and state hooks instead. Where a screenshot
is genuinely useful it must be scoped to a DOM element and **mask any emoji**, whose
artwork legitimately differs per platform (§2).

**Caveat (documented, accepted by the owner):** WebKit-in-Playwright approximates the
Safari engine but is **not identical** to real iOS Safari for audio unlock, storage
eviction, and `100vh`/safe-area behavior. The owner chose the engine matrix as the
gate; a manual **real-iOS-Safari spot-check per release** is recommended as advisory
follow-up, not a blocking gate.

## 9. Per-area compatibility responsibilities

| Area | Owns |
|---|---|
| 00 Core Platform | Pointer Events input + `pointercancel`; gesture-hygiene CSS; `visualViewport`/safe-area/orientation wiring; the Playwright matrix config; pointer→arena mapping through `ThreeView.screenToWorld`. |
| 01 Gameplay Engine | Aim + hold-to-fire from the pointer; overheat/jam under held touch. |
| 06 Audio | `webkitAudioContext` fallback; synchronous in-gesture unlock; visibility resume + auto-pause. |
| 09 State & Persistence | Write-time private-mode fallback; ITP limitation note. |
| 10 HUD & UI | DOM UI layer: `pointer-events` discipline so aim is never swallowed; minimum tap-target sizes; safe-area-aware layout; keyboard navigability; emoji font stack. |
| 11 Art & Visual Style | WebGL2 probe + silent no-op fallback; DPR cap; quality tiers; context-loss handling; per-frame allocation and disposal discipline. |
| 07 Main Menu / 08 Highscores / 12 Credits | Pointer + keyboard navigable; readable and tappable at mobile scale within safe areas. |
