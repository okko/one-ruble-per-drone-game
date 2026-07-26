/**
 * The in-game Three.js world view (§request — fully replaces the Canvas-2D in-game UI). It is a PURE
 * RENDERER over the deterministic engine: it reads `GameState` + the scene's `PlayingViewState` each
 * frame and never mutates gameplay. The combat sim still runs in the fixed 384×216 "arena" space
 * (collision/aim math unchanged); this module maps that space into a 3D scene and back:
 *
 *  - far layer: the damageable Moscow skyline — one tower per `content.combat.skyline.buildings`, each
 *    a stack of slab meshes; `building.cut` shears slabs off the top (and a paid/passive repair grows
 *    them back), so damage + reparations are literally parts removed and restored;
 *  - near layer: the soldier's 32-storey tower, drawn as a cut-away cross-section so you see the floors
 *    inside; residents sit on the top 12 floors. The gun + soldier ride its roof (the firing post);
 *  - drones dive from the sky at the skyline towers; projectiles are tracer dots; a muzzle flash fires
 *    with the gun. Day/night drives the sky + window glow.
 *
 * Two camera framings, cross-faded by `mode`: SHOOTING looks out over the skyline from the roof;
 * INTERIOR drops down the cut-away to the floor being visited. Aim ray-casts against the fixed z=0
 * action plane through a dedicated, never-moved camera, so `screenToWorld` stays exact.
 *
 * Built defensively: if WebGL is unavailable the factory returns a no-op view so the headless engine
 * (tests / the cross-browser smoke's `__combat` hook) keeps running without a renderer.
 */
import * as THREE from 'three';
import { colorOf, mixInto } from './theme';
import type { WorldColorKey } from './theme';
import { daylightAt } from '../../core/difficulty';
import type { Content } from '../../content/loader';
import type { GameState } from '../../state/game-state';
import type { PlayingViewState } from '../../state/playing-view';
import type { Vec2 } from '../../core/math';
import {
  ACTION_Z,
  ARENA_CX,
  AS,
  ax,
  ay,
  floorSlabY,
  GROUND_Y,
  POST_Y,
  ROOF_DECK_THICKNESS,
  ROOF_DECK_TOP_Y,
  ROOF_DECK_Y,
  ROOF_Y,
  SKYLINE_Z,
  STOREYS,
  STORY_H,
  toArena,
  TOWER_D,
  TOWER_W,
  TOWER_X,
  TOWER_Z,
} from './mapping';
import { createCameraDirector, type CameraState } from './camera-director';
import { createSoldier, SOLDIER_H, soldierPoseFrom } from './soldier';
import { rigFor } from './lighting';
import {
  createTierGovernor,
  isSoftwareRenderer,
  pickTier,
  pixelRatioFor,
  policyFor,
  type Tier,
  type TierPolicy,
} from './quality';
// Type-only, so `verbatimModuleSyntax` erases it and the addons stay out of the main bundle; the
// implementation arrives via the dynamic `import('./post')` in `buildChain`.
import type { PostChain } from './post';
/** Boot-time presentation options. Accessibility is read once: the settings screen is not live yet. */
export interface ThreeViewOptions {
  /** Kills the whole post chain, bloom included (docs/areas/11-art-visual-style.md §3.6). */
  reducedFlash?: boolean | undefined;
}

/** A read-only mirror of what the GPU is being asked to do, for the compatibility gate to assert. */
export interface RenderStats {
  tier: Tier;
  /** True when the EffectComposer is in use rather than a direct render. */
  composited: boolean;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
}

export interface ThreeView {
  /** Resize the renderer to the CSS viewport (rendered at the device's native pixel ratio). */
  resize(cssW: number, cssH: number): void;
  /** Canvas-relative pixel → 384×216 arena coordinate (for aiming). Uses the fixed shooting camera. */
  screenToWorld(canvasX: number, canvasY: number): Vec2;
  /** Draw one frame from the current state + interaction view model. */
  render(gs: GameState, alpha: number, vs: PlayingViewState): void;
  /**
   * Ask the camera director to head for a framing. The scenes drive this — the view never guesses
   * what the app is doing (docs/areas/11-art-visual-style.md §3.7).
   */
  setCameraState(state: CameraState): void;
  /** Begin the opening fly-up (ground floor → rooftop post); called when a run starts. */
  startIntro(): void;
  /** What the renderer is currently spending. Drives the bounded-draw-call gate (compatibility §7). */
  stats(): RenderStats;
  dispose(): void;
}

// A renderer-less stand-in used when WebGL is unavailable (headless/unsupported engines, e.g. CI
// Firefox without a GL context). The sim keeps running; the world just isn't drawn, and every screen
// still works because they are DOM over a canvas that simply stays black.
function noopView(): ThreeView {
  return {
    resize() {},
    screenToWorld: () => ({ x: ARENA_CX, y: POST_Y }),
    render() {},
    setCameraState() {},
    startIntro() {},
    stats: () => ({
      tier: 'low',
      composited: false,
      drawCalls: 0,
      triangles: 0,
      geometries: 0,
      textures: 0,
      programs: 0,
    }),
    dispose() {},
  };
}

interface SkylineTower {
  buildingId: number;
  slabs: THREE.Mesh[]; // bottom → top; the top `floor(cut)` are hidden
}

export function createThreeView(
  canvas: HTMLCanvasElement,
  content: Content,
  options: ThreeViewOptions = {},
): ThreeView {
  // Acquire the WebGL2 context ourselves so we can bail out SILENTLY when it's unavailable. Letting
  // THREE.WebGLRenderer create it would log console.error (and fire webglcontextcreationerror) BEFORE
  // it throws — which trips the strict no-console-error cross-browser smokes on headless engines that
  // disable WebGL (e.g. CI Firefox: "AllowWebgl2:false"). A bare getContext probe is quiet (no Three
  // listener attached yet), and passing the ready context in skips Three's own getContext+throw path,
  // so a missing GL stays silent and the sim runs renderer-less via the no-op view.
  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = canvas.getContext('webgl2', { alpha: true, antialias: true, powerPreference: 'high-performance' });
  } catch {
    gl = null;
  }
  if (!gl) return noopView(); // no WebGL (headless/unsupported) — keep the sim running renderer-less

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: true, powerPreference: 'high-performance' });
  } catch {
    return noopView(); // GL present but renderer init failed — keep the sim running renderer-less
  }

  // ---- Colour pipeline ----------------------------------------------------------------------
  // Lighting maths happens in linear space and is converted to sRGB exactly once, on the way out
  // (docs/areas/11-art-visual-style.md §3.6). ACES gives the highlight rolloff that lets a muzzle
  // flash or a lit window go genuinely bright without tearing a white hole in the frame — the "not
  // photoreal, but not flat either" look §3.1 asks for. Exposure is then the single dial that makes
  // night feel like night (§3.5: "exposure, not paint").
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;

  // ---- Quality tier -------------------------------------------------------------------------
  // Guessed once from what the device admits about itself, then corrected downward from frames we
  // actually observe. "Tier down, don't drop frames" (docs/compatibility.md §7) — the fixed-timestep
  // sim is never the thing that gives.
  const nav: Navigator | undefined = typeof navigator !== 'undefined' ? navigator : undefined;
  const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio ?? 1) : 1;
  // The unmasked renderer string where the extension exists, the plain one otherwise. Both are
  // wrapped because a locked-down engine can throw on either.
  let rendererName: string | null = null;
  try {
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    rendererName = String(
      (dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null) ?? gl.getParameter(gl.RENDERER) ?? '',
    );
  } catch {
    rendererName = null;
  }
  let tier = pickTier({
    mobile: /Android|iPhone|iPad|iPod/i.test(nav?.userAgent ?? '') || (nav?.maxTouchPoints ?? 0) > 1,
    softwareRenderer: isSoftwareRenderer(rendererName),
    cores: nav?.hardwareConcurrency ?? 0,
    // `deviceMemory` is Chromium-only and not in lib.dom; absent means "wouldn't say", not "zero".
    memoryGb: (nav as { deviceMemory?: number } | undefined)?.deviceMemory ?? 0,
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
  });
  const reducedFlash = options.reducedFlash === true;
  let policy: TierPolicy = policyFor(tier, { reducedFlash });
  const governor = createTierGovernor(tier);
  renderer.setPixelRatio(pixelRatioFor(tier, dpr));

  // ---- Shadows ------------------------------------------------------------------------------
  // Soft, and deliberately CHEAP: the shadow camera below covers the rooftop post alone, so the map's
  // whole resolution is spent on the one place the player is looking. The skyline is lit but never
  // shadowed — at that distance a shadow reads as noise, and paying for it would cost the tier.
  renderer.shadowMap.enabled = policy.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 400);
  // A fixed camera at the shooting pose, used ONLY for the aim raycast so screenToWorld never drifts
  // while the render camera lerps into the interior.
  const aimCamera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 400);

  // ---- Lights + sky -------------------------------------------------------------------------
  // Hemisphere fill + a directional key: §3.5 is explicit that ambient-only lighting flattens the
  // towers and is not acceptable. `lighting.rigFor` owns every number these are driven by.
  const hemi = new THREE.HemisphereLight(colorOf('cloud'), colorOf('bounce'), 1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(colorOf('sunNoon'), 1.1);
  sun.position.set(-8, 30, 14);
  scene.add(sun);

  if (policy.shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(policy.shadowMapSize, policy.shadowMapSize);
    // Bounded to the rooftop post and nothing else. Sized off the tower footprint and the soldier's
    // own height rather than assumed metres — a man here is SOLDIER_H = 0.58 units, so a bias tuned
    // for a human-scale scene would be an order of magnitude wrong and would peter-pan his feet.
    const span = Math.max(TOWER_W, TOWER_D) * 0.75;
    const cam = sun.shadow.camera;
    cam.left = -span;
    cam.right = span;
    cam.top = span;
    cam.bottom = -span;
    cam.near = 1;
    cam.far = 80;
    cam.updateProjectionMatrix();
    sun.target.position.set(TOWER_X, ROOF_DECK_TOP_Y, TOWER_Z);
    scene.add(sun.target);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = SOLDIER_H * 0.04;
  }

  const skyGeo = new THREE.SphereGeometry(220, 24, 16);
  const skyMat = new THREE.MeshBasicMaterial({ color: colorOf('skyDayTop'), side: THREE.BackSide, fog: false });
  scene.add(new THREE.Mesh(skyGeo, skyMat));

  const sunSprite = new THREE.Mesh(
    new THREE.CircleGeometry(7, 24),
    new THREE.MeshBasicMaterial({ color: colorOf('flash') }),
  );
  sunSprite.position.set(40, ROOF_Y + 26, -120);
  scene.add(sunSprite);

  // Ground: every tower stands on world Y = GROUND_Y (see ./mapping). The skyline + the soldier's
  // tower share it, so nothing sits underground (drones/the gun still map ABOVE it via ay()).
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(800, 400),
    new THREE.MeshStandardMaterial({ color: colorOf('ink') }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, GROUND_Y, -20);
  scene.add(ground);

  // ---- Far layer: damageable Moscow skyline -------------------------------------------------
  // Towers rise from the ground to the world-Y the drones dive at (ay of each building's roof), so a
  // diving drone meets the tower top and the whole thing reads as one grounded skyline.
  const skylineGroup = new THREE.Group();
  scene.add(skylineGroup);
  const towers: SkylineTower[] = [];
  const windowGeo = new THREE.PlaneGeometry(0.5, 0.5);
  for (const b of content.combat.skyline.buildings) {
    const roofY = ay(content.combat.skyline.groundY - b.height); // world height (drones target this)
    const slabH = (roofY - GROUND_Y) / b.stories;
    const w = b.width * AS;
    const slabs: THREE.Mesh[] = [];
    const body = colorOf(b.id % 2 === 0 ? 'concrete' : 'concreteDk');
    for (let s = 0; s < b.stories; s++) {
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(w, slabH * 0.96, w * 0.7),
        new THREE.MeshStandardMaterial({ color: body, flatShading: true }),
      );
      slab.position.set(ax(b.x), GROUND_Y + slabH * (s + 0.5), SKYLINE_Z);
      // Lit windows on the camera-facing side (emissive so night reads).
      const win = new THREE.Mesh(
        windowGeo,
        new THREE.MeshStandardMaterial({
          color: colorOf('windowLit'),
          emissive: colorOf('windowLit'),
          emissiveIntensity: 0.8,
        }),
      );
      win.position.set(0, 0, w * 0.36);
      win.scale.set(w * 0.5, slabH * 0.5, 1);
      slab.add(win);
      skylineGroup.add(slab);
      slabs.push(slab);
    }
    towers.push({ buildingId: b.id, slabs });
  }

  // ---- Near layer: the soldier's 32-storey cut-away tower -----------------------------------
  const towerGroup = new THREE.Group();
  scene.add(towerGroup);
  const TW = TOWER_W; // tower footprint width
  const TD = TOWER_D; // depth
  // The tower stands ON the ground (base at GROUND_Y) and rises 32 storeys to the roof at ROOF_Y, where
  // the gun is. Floor 32's ceiling IS the roof deck; the soldier stands on top of it (storey 33), in the
  // open — not inside the building. (ROOF_Y == 32·STORY_H, so the base lands exactly on the ground.)
  const towerX = TOWER_X;
  // Back + side walls (front omitted → the cut-away reveals the floors).
  const wallMat = new THREE.MeshStandardMaterial({ color: colorOf('concreteDk'), flatShading: true });
  const back = new THREE.Mesh(new THREE.BoxGeometry(TW, ROOF_Y, 0.2), wallMat);
  back.position.set(towerX, GROUND_Y + ROOF_Y / 2, TOWER_Z - TD / 2);
  towerGroup.add(back);
  for (const sx of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.2, ROOF_Y, TD), wallMat);
    side.position.set(towerX + (sx * TW) / 2, GROUND_Y + ROOF_Y / 2, TOWER_Z);
    towerGroup.add(side);
  }
  // Floor slabs + a highlight strip per floor (lets the current floor glow in interior mode).
  const floorHi: THREE.Mesh[] = []; // index 1..STOREYS (floor number); 0 unused
  floorHi.length = STOREYS + 1;
  const occupantByFloor = new Map(content.economy.roster.map((r) => [r.floor, r] as const));
  for (let f = 1; f <= STOREYS; f++) {
    const y = floorSlabY(f);
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(TW, 0.12, TD),
      new THREE.MeshStandardMaterial({ color: colorOf('shadow'), flatShading: true }),
    );
    deck.position.set(towerX, y, TOWER_Z);
    towerGroup.add(deck);
    // A dim back-glow panel for the floor (brightened when this floor is being visited).
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(TW * 0.92, STORY_H * 0.86),
      new THREE.MeshStandardMaterial({
        color: colorOf('windowLit'),
        emissive: colorOf('windowLit'),
        emissiveIntensity: 0.12,
      }),
    );
    glow.position.set(towerX, y + STORY_H / 2, TOWER_Z - TD / 2 + 0.12);
    towerGroup.add(glow);
    floorHi[f] = glow;
    // A resident marker (little figure) on occupied floors, the same size as the soldier so the
    // building reads at a consistent human scale.
    const occ = occupantByFloor.get(f);
    if (occ) {
      const r = SOLDIER_H * 0.16;
      const body = SOLDIER_H - 2 * r;
      const fig = new THREE.Mesh(
        new THREE.CapsuleGeometry(r, body, 4, 8),
        new THREE.MeshStandardMaterial({ color: colorOf('skin'), flatShading: true }),
      );
      fig.position.set(towerX - TW * 0.28, y + SOLDIER_H / 2, TOWER_Z + TD * 0.18);
      towerGroup.add(fig);
    }
  }

  // Roof deck capping the top floor (the rooftop the soldier stands on) + a low sandbag parapet. Its
  // top face is ROOF_DECK_TOP_Y — the surface everything on the roof is placed against.
  const roofDeck = new THREE.Mesh(
    new THREE.BoxGeometry(TW, ROOF_DECK_THICKNESS, TD),
    new THREE.MeshStandardMaterial({ color: colorOf('concrete'), flatShading: true }),
  );
  roofDeck.position.set(towerX, ROOF_DECK_Y, TOWER_Z);
  towerGroup.add(roofDeck);
  const parapetMat = new THREE.MeshStandardMaterial({ color: colorOf('uniformDk'), flatShading: true });
  // Waist-high on the soldier. Anything taller hides the man the game is about.
  const PARAPET_H = SOLDIER_H * 0.55;
  const parapetRails: THREE.Mesh[] = [];
  for (const [dx, dz, w, d] of [
    [0, -TD / 2, TW, 0.25],
    [-TW / 2, 0, 0.25, TD],
    [TW / 2, 0, 0.25, TD],
  ] as const) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(w, PARAPET_H, d), parapetMat);
    rail.position.set(towerX + dx, ROOF_DECK_TOP_Y + PARAPET_H / 2, TOWER_Z + dz);
    towerGroup.add(rail);
    parapetRails.push(rail);
  }

  // ---- The gun + soldier ON the roof deck (storey 33) -----------------------------------------
  // The whole post sits on the deck at the tower depth (TOWER_Z), centred on the firing column
  // (ax(pivot.x) == towerX == 0). It fires OUT into the action plane (ACTION_Z) where the drones are;
  // the projectile loop below reconciles tracers from this muzzle into that plane (see FIRE_BLEND).
  //
  // Everything here is sized against SOLDIER_H. One world unit is roughly 3.3 m (32 storeys of
  // STORY_H make the tower), so the gun is a ~3 m barrel on a chest-high mount — a weapon a man can
  // stand behind, not the eight-metre prop that used to sit here.
  const post = content.combat.gun.pivot; // arena-space firing column the sim spawns projectiles from
  const BARREL_LEN = SOLDIER_H * 1.55; // barrel length & muzzle reach (tip distance from the yaw pivot)
  /** Height of the gun's yaw pivot above the roof deck's top face — the soldier's chest. */
  const GUN_PIVOT_H = SOLDIER_H * 0.62;
  // Arena units over which a tracer sheds the muzzle offset and settles into the action plane. Spread
  // across the whole engagement range (gun→arena-top is ~196) so the depth correction is a shallow,
  // straight diagonal rather than a sharp z-step right off the barrel — the join lands off-screen.
  const FIRE_BLEND = 220;
  const gunPivot = new THREE.Group();
  gunPivot.position.set(ax(post.x), ROOF_DECK_TOP_Y + GUN_PIVOT_H, TOWER_Z);
  scene.add(gunPivot);

  // The soldier is added to the SCENE, not to the gun. He used to be a child of `gunPivot`, which
  // meant he inherited the barrel's rotation and cartwheeled with the aim; he now stands on his own
  // feet beside the post and merely twists toward it (docs/areas/11-art-visual-style.md §3.4).
  const soldier = createSoldier();
  scene.add(soldier.group);
  /** Where he stands on the roof: just behind the gun, on the deck's top face. */
  const roofSpot = new THREE.Vector3(
    gunPivot.position.x - SOLDIER_H * 0.15,
    ROOF_DECK_TOP_Y,
    TOWER_Z + SOLDIER_H * 0.8,
  );
  soldier.group.position.copy(roofSpot);

  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(BARREL_LEN * 0.045, BARREL_LEN * 0.045, BARREL_LEN, 8),
    new THREE.MeshStandardMaterial({ color: colorOf('gunmetal'), flatShading: true }),
  );
  barrel.geometry.translate(0, BARREL_LEN / 2, 0); // pivot at one end
  const barrelYaw = new THREE.Group();
  barrelYaw.add(barrel);
  gunPivot.add(barrelYaw);
  const muzzle = new THREE.Mesh(
    new THREE.SphereGeometry(BARREL_LEN * 0.13, 8, 6),
    new THREE.MeshBasicMaterial({ color: colorOf('flashHot') }),
  );
  muzzle.visible = false;
  barrelYaw.add(muzzle);
  // A stubby mount under the pivot, so the gun stands on the deck rather than floating at his chest.
  const mount = new THREE.Mesh(
    new THREE.CylinderGeometry(SOLDIER_H * 0.1, SOLDIER_H * 0.16, GUN_PIVOT_H, 6),
    new THREE.MeshStandardMaterial({ color: colorOf('gunmetalDk'), flatShading: true }),
  );
  mount.position.y = -GUN_PIVOT_H / 2;
  gunPivot.add(mount);

  // ---- Who casts, and onto what -------------------------------------------------------------
  // The rooftop post is the ONLY shadow-casting region, matching the shadow camera set up above.
  // Contact shadows here are what stop the soldier and the gun from looking pasted onto the deck; a
  // shadow from a tower two kilometres away, at this map resolution, would be a smear.
  roofDeck.receiveShadow = true;
  for (const rail of parapetRails) {
    rail.castShadow = true;
    rail.receiveShadow = true;
  }
  gunPivot.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  soldier.group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });

  // ---- Pools: drones + projectiles ----------------------------------------------------------
  const droneGeo = new THREE.IcosahedronGeometry(0.55, 0);
  const dronePool: THREE.Mesh[] = [];
  const projGeo = new THREE.SphereGeometry(0.12, 6, 4);
  const projMat = new THREE.MeshBasicMaterial({ color: colorOf('flash') });
  const projPool: THREE.Mesh[] = [];

  function droneColorKey(kind: string): WorldColorKey {
    switch (kind) {
      case 'heavy':
        return 'droneBoss';
      case 'kamikaze':
        return 'droneBomber';
      case 'frenzy':
        return 'droneSwarm';
      case 'boss':
        return 'droneBoss';
      case 'decoy_bird':
        return 'cream';
      default:
        return 'droneScout';
    }
  }

  // ---- Camera --------------------------------------------------------------------------------
  // One director owns every framing (menu orbit, opening crane, shooting, interior, pause). See
  // ./camera-director — the pose maths lives there, free of three.js, so it can be proven by test.
  const director = createCameraDirector('shooting', { floor: STOREYS, time: 0 });
  // The aim camera is DERIVED from the director's aim pose and never touched again. Copying the
  // shooting numbers here by hand is how aiming and framing quietly drift apart.
  const aim = director.aimPose;
  aimCamera.position.set(aim.eye.x, aim.eye.y, aim.eye.z);
  aimCamera.lookAt(aim.look.x, aim.look.y, aim.look.z);
  aimCamera.fov = aim.fov;
  aimCamera.updateProjectionMatrix();

  const ray = new THREE.Raycaster();
  const actionPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -ACTION_Z);
  let cssW = 1;
  let cssH = 1;

  // ---- The post chain, and the tier it belongs to --------------------------------------------
  // The chain starts as a direct render and is UPGRADED once its chunk arrives. `./post` pulls in the
  // post-processing addons, which are bulky, so it is loaded on demand: a phone on the low tier — or
  // anyone who has asked for `reducedFlash` — never downloads a chain it would not have run.
  // Presentation is allowed to arrive late; it is never allowed to hold up a frame.
  let chain: PostChain = directChain();
  /** Guards against a slow import landing after a tier change or a dispose has superseded it. */
  let chainToken = 0;

  function directChain(): PostChain {
    return {
      composited: false,
      render: () => renderer.render(scene, camera),
      setSize: () => {},
      dispose: () => {},
    };
  }

  function buildChain(): void {
    const token = ++chainToken;
    chain.dispose();
    chain = directChain();
    if (!policy.post) return;
    void import('./post')
      .then(({ createPostChain }) => {
        if (token !== chainToken) return; // superseded while in flight
        chain = createPostChain(renderer, scene, camera, policy, {
          width: cssW,
          height: cssH,
          pixelRatio: renderer.getPixelRatio(),
        });
        chain.setSize(cssW, cssH, renderer.getPixelRatio());
      })
      .catch(() => {
        // The picture is a nicety; the shift is not. A chunk that fails to load leaves the direct
        // render in place and says nothing, because the boot smokes assert a silent console.
        chainToken += 1;
      });
  }

  /**
   * Rebuild the render chain for a new tier. Called only when the governor demotes, which is rare
   * and never per-frame — this throws away GPU resources and recompiles every shader in the scene.
   */
  function applyTier(next: Tier): void {
    tier = next;
    policy = policyFor(tier, { reducedFlash });
    renderer.setPixelRatio(pixelRatioFor(tier, dpr));

    if (renderer.shadowMap.enabled !== policy.shadows) {
      renderer.shadowMap.enabled = policy.shadows;
      sun.castShadow = policy.shadows;
      // Toggling shadows changes the #defines every lit material compiles with, so three needs to be
      // told the programs are stale. Without this the scene keeps rendering with the old ones and the
      // shadows either linger or never appear.
      scene.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) m.needsUpdate = true;
      });
    }

    buildChain();
  }

  buildChain();

  // The opening crane holds at the `intro` pose, then hands off to `shooting`.
  const INTRO_DUR = 2.6;
  let introT = 1; // 1 = finished; startIntro() resets to 0
  const lookAt = new THREE.Vector3();

  function updateCamera(vs: PlayingViewState, dt: number, now: number): void {
    if (introT < 1) {
      introT = Math.min(1, introT + dt / INTRO_DUR);
      if (introT >= 1) director.setState('shooting');
    } else if (director.state === 'intro' || director.state === 'shooting' || director.state === 'interior') {
      // While a run is live the mode drives the framing; menu/pause are set by the scenes.
      director.setState(vs.mode === 'interior' ? 'interior' : 'shooting');
    }

    director.update(dt, { floor: vs.floor, time: now });
    const pose = director.pose;
    camera.position.set(pose.eye.x, pose.eye.y, pose.eye.z);
    camera.lookAt(lookAt.set(pose.look.x, pose.look.y, pose.look.z));
    if (camera.fov !== pose.fov) {
      camera.fov = pose.fov;
      camera.updateProjectionMatrix();
    }
  }

  let lastT = 0;
  let muzzleTimer = 0;
  /** Wall clock at the previous frame, for the tier governor. 0 until the first frame has landed. */
  let lastFrameAt = 0;

  // Where the soldier is standing right now, eased between the roof post and the flat he is visiting.
  // He is NEVER hidden: going indoors moves him, it does not delete him
  // (docs/areas/11-art-visual-style.md §3.4 requirement 5).
  const soldierSpot = roofSpot.clone();
  const interiorSpot = new THREE.Vector3();

  function updateSoldier(gs: GameState, vs: PlayingViewState, dt: number, now: number): void {
    const m = gs.meters;
    let worst = 0;
    let crisis = false;
    for (const key of Object.keys(m.values) as (keyof typeof m.values)[]) {
      worst = Math.max(worst, m.values[key]);
      if (m.inCrisis[key]) crisis = true;
    }

    if (vs.mode === 'interior') {
      // Standing in the visited flat, on that floor's slab, opposite its resident.
      interiorSpot.set(towerX + TW * 0.22, floorSlabY(vs.floor), TOWER_Z + TD * 0.1);
    } else {
      interiorSpot.copy(roofSpot);
    }
    // Ease rather than cut, so he visibly travels between the post and the flat alongside the camera.
    soldierSpot.lerp(interiorSpot, Math.min(1, dt * 3));
    soldier.group.position.copy(soldierSpot);

    soldier.update({
      dt,
      aimAngle: gs.combat.aim.effectiveAngle,
      pose: soldierPoseFrom({
        firing: gs.combat.gun.firing && !gs.combat.gun.overheated && !gs.combat.gun.jammed,
        crisis,
        fatigue: worst / 100,
      }),
      time: now,
    });
  }

  function render(gs: GameState, _alpha: number, vs: PlayingViewState): void {
    // Frame COST is measured as the interval between frames rather than the time spent inside this
    // function: rAF backpressure means the interval includes the GPU actually finishing, which is the
    // thing that stutters. Time spent here only measures how fast we hand work over.
    const wall = performance.now();
    if (lastFrameAt > 0 && governor.sample(wall - lastFrameAt)) applyTier(governor.tier);
    lastFrameAt = wall;

    const c = gs.combat;
    const now = gs.time.shiftSeconds;
    const dt = Math.max(0, Math.min(0.1, now - lastT));
    lastT = now;

    // Day / night. `lighting.rigFor` owns every constant; this just applies them.
    const daylight = daylightAt(now, content.combat.difficulty);
    const rig = rigFor(daylight);
    mixInto(skyMat.color, 'skyDayTop', 'skyNightTop', 1 - daylight);
    hemi.intensity = rig.hemisphere;
    sun.intensity = rig.key;
    mixInto(sun.color, rig.keyColor.from, rig.keyColor.to, rig.keyColor.t);
    renderer.toneMappingExposure = rig.exposure;
    sunSprite.material.color.copy(colorOf(daylight > 0.4 ? 'flash' : 'cloud'));
    const winGlow = rig.windowGlow;

    // Skyline damage: hide the top floor(cut) slabs of each tower; dim the highest survivor.
    for (const t of towers) {
      const b = c.skyline.buildings.find((x) => x.id === t.buildingId);
      const cut = b ? Math.floor(b.cut) : 0;
      t.slabs.forEach((slab, i) => {
        const alive = i < t.slabs.length - cut;
        slab.visible = alive;
        const win = slab.children[0] as THREE.Mesh | undefined;
        if (win && win.material instanceof THREE.MeshStandardMaterial) win.material.emissiveIntensity = alive ? winGlow : 0;
      });
    }

    // Drones.
    for (let i = 0; i < c.drones.length; i++) {
      let m = dronePool[i];
      if (!m) {
        m = new THREE.Mesh(droneGeo, new THREE.MeshStandardMaterial({ flatShading: true }));
        dronePool.push(m);
        scene.add(m);
      }
      const d = c.drones[i];
      if (!d) continue;
      m.visible = true;
      m.position.set(ax(d.pos.x), ay(d.pos.y), ACTION_Z);
      const scale = Math.max(0.6, d.radius / 5);
      m.scale.setScalar(scale);
      m.rotation.x += 0.05;
      m.rotation.y += 0.07;
      if (m.material instanceof THREE.MeshStandardMaterial) {
        m.material.color.copy(colorOf(d.colorTag !== undefined ? 'accentPink' : droneColorKey(d.kind)));
      }
    }
    for (let i = c.drones.length; i < dronePool.length; i++) {
      const m = dronePool[i];
      if (m) m.visible = false;
    }

    // Gun aim + muzzle flash. The barrel models +y; arena angle θ maps to world dir (cosθ, -sinθ)
    // (arena y is down, world y is up), i.e. a z-rotation of -(θ + π/2) from the +y rest pose. The
    // muzzle (barrel tip) is the visible source of fire; rotating +y·BARREL_LEN by aimZ gives its world
    // point, which the tracer blend below leans on so shots leave the barrel rather than the deck.
    gunPivot.visible = vs.mode === 'shooting';
    const aimZ = -(c.aim.effectiveAngle + Math.PI / 2);    barrelYaw.rotation.z = aimZ;
    const muzzleX = gunPivot.position.x - BARREL_LEN * Math.sin(aimZ);
    const muzzleY = gunPivot.position.y + BARREL_LEN * Math.cos(aimZ);
    const muzzleZ = gunPivot.position.z;
    // Offset from where the sim spawns a shot (the firing column, mapped flat into the action plane) to
    // the actual muzzle. Tracers carry this offset at spawn and shed it linearly over FIRE_BLEND, so a
    // shot is a straight line from the barrel to its true path — never dipping back toward the post.
    const fireOffX = muzzleX - ax(post.x);
    const fireOffY = muzzleY - ay(post.y);
    const fireOffZ = muzzleZ - (ACTION_Z + 0.2);
    if (c.gun.firing && !c.gun.overheated && !c.gun.jammed) {
      muzzleTimer = 0.05;
      muzzle.position.set(0, BARREL_LEN, 0);
    }
    muzzleTimer = Math.max(0, muzzleTimer - dt);
    muzzle.visible = muzzleTimer > 0;

    // Projectiles. The sim flies them from the firing column (post) along the aim in arena 2D. The gun
    // stands on the roof at TOWER_Z while the drones fly in the ACTION_Z plane, so each tracer keeps the
    // muzzle offset at spawn and sheds it linearly over the first FIRE_BLEND arena units of travel: it
    // leaves the barrel as a straight shot, then settles onto its true action-plane path where it hits.
    for (let i = 0; i < c.projectiles.length; i++) {
      let m = projPool[i];
      if (!m) {
        m = new THREE.Mesh(projGeo, projMat);
        projPool.push(m);
        scene.add(m);
      }
      const p = c.projectiles[i];
      if (!p) continue;
      m.visible = true;
      const k = 1 - Math.min(1, Math.hypot(p.pos.x - post.x, p.pos.y - post.y) / FIRE_BLEND);
      m.position.set(ax(p.pos.x) + fireOffX * k, ay(p.pos.y) + fireOffY * k, ACTION_Z + 0.2 + fireOffZ * k);
    }
    for (let i = c.projectiles.length; i < projPool.length; i++) {
      const m = projPool[i];
      if (m) m.visible = false;
    }

    // Highlight the floor being visited.
    for (let f = 1; f <= STOREYS; f++) {
      const glow = floorHi[f];
      if (glow && glow.material instanceof THREE.MeshStandardMaterial) {
        const lit = vs.mode === 'interior' && f === vs.floor;
        glow.material.emissiveIntensity = lit ? 0.95 : 0.12 + (1 - daylight) * 0.25;
      }
    }

    updateSoldier(gs, vs, dt, now);
    updateCamera(vs, dt, now);
    chain.render();
  }

  function resize(w: number, h: number): void {
    cssW = Math.max(1, w);
    cssH = Math.max(1, h);
    renderer.setSize(cssW, cssH, false);
    chain.setSize(cssW, cssH, renderer.getPixelRatio());
    const aspect = cssW / cssH;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    aimCamera.aspect = aspect;
    aimCamera.updateProjectionMatrix();
  }

  function screenToWorld(canvasX: number, canvasY: number): Vec2 {
    const ndc = new THREE.Vector2((canvasX / cssW) * 2 - 1, -(canvasY / cssH) * 2 + 1);
    ray.setFromCamera(ndc, aimCamera);
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(actionPlane, hit)) return { x: ARENA_CX, y: 60 };
    return toArena(hit.x, hit.y);
  }

  return {
    resize,
    screenToWorld,
    render,
    setCameraState(state: CameraState): void {
      director.setState(state);
    },
    startIntro(): void {
      introT = 0;
      director.setState('intro', { immediate: true });
    },
    stats(): RenderStats {
      const info = renderer.info;
      return {
        tier,
        composited: chain.composited,
        drawCalls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        programs: info.programs?.length ?? 0,
      };
    },
    dispose(): void {
      // Invalidate any post chunk still in flight, so it cannot build a composer over a disposed
      // renderer after we have gone.
      chainToken += 1;
      soldier.dispose();
      chain.dispose();
      renderer.dispose();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          const mat = o.material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat.dispose();
        }
      });
    },
  };
}
