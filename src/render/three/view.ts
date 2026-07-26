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
import { daylightAt, dayCycleAt } from '../../core/difficulty';
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
import { FOG_FAR, FOG_NEAR, rigFor, sunDirectionFor } from './lighting';
import { createSky } from './sky';
import { createCity } from './city';
import { createRooftop } from './rooftop';
import { createWeapon } from './weapon';
import { advanceRecoil, createRecoil, kickRecoil } from './recoil';
import { createDrones, type DroneSighting } from './drones';
import { createVfx } from './particles';
import { loadDetailTextures, type DetailTextures } from './assets';
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

/**
 * How far the key light orbits from the rooftop post.
 *
 * A directional light has no position in the lighting maths — only a direction — but its position is
 * what the shadow camera is built around, so it has to sit far enough out to contain the post and
 * close enough in to keep the shadow map's depth range tight.
 */
const SUN_DISTANCE = 34;

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
  // The key light orbits the rooftop at a fixed distance, so however far round the day has turned it
  // is always the same distance inside the shadow camera's `far` plane. Reused every frame (§7).
  const sunDir = new THREE.Vector3(0, 1, 0);

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
    // The light now orbits, so the frustum has to hold it at every bearing: `near` must clear the
    // post at the closest approach and `far` must still reach it at the furthest.
    cam.near = 1;
    cam.far = SUN_DISTANCE * 2;
    cam.updateProjectionMatrix();
    sun.target.position.set(TOWER_X, ROOF_DECK_TOP_Y, TOWER_Z);
    scene.add(sun.target);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = SOLDIER_H * 0.04;
  }

  const skyView = createSky(scene, renderer);
  // Aerial perspective. Linear rather than exponential so the near limit is a number this file can
  // state and `lighting.ts` can justify: the action plane must stay entirely out of it (§3.1).
  scene.fog = new THREE.Fog(colorOf('skyDayLow').clone(), FOG_NEAR, FOG_FAR);

  // Ground: every tower stands on world Y = GROUND_Y (see ./mapping). The skyline + the soldier's
  // tower share it, so nothing sits underground (drones/the gun still map ABOVE it via ay()).
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(800, 400),
    new THREE.MeshStandardMaterial({ color: colorOf('ink') }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, GROUND_Y, -20);
  scene.add(ground);

  // Surfaces that get the generated concrete maps once (and if) they arrive, each stated with the
  // world size the tiling should suit. Collected during construction rather than found by traversal
  // afterwards, so what is textured is stated where the surface is built.
  const concreteSurfaces: { material: THREE.MeshStandardMaterial; size: number }[] = [];

  // ---- Far layer: the damageable Moscow skyline ----------------------------------------------
  // Built entirely by ./city from ./city-layout, which is where the silhouette and the damage
  // ordering are decided and proven. Towers still rise to the world y a drone dives at, so a diving
  // drone meets the tower top and the whole thing reads as one grounded city.
  const city = createCity(scene, content.combat.skyline);

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
  concreteSurfaces.push({ material: wallMat, size: ROOF_Y });
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
  const roofDeckMat = new THREE.MeshStandardMaterial({ color: colorOf('concrete'), flatShading: true });
  concreteSurfaces.push({ material: roofDeckMat, size: TW });
  const roofDeck = new THREE.Mesh(new THREE.BoxGeometry(TW, ROOF_DECK_THICKNESS, TD), roofDeckMat);
  roofDeck.position.set(towerX, ROOF_DECK_Y, TOWER_Z);
  towerGroup.add(roofDeck);
  const parapetMat = new THREE.MeshStandardMaterial({ color: colorOf('uniformDk'), flatShading: true });
  concreteSurfaces.push({ material: parapetMat, size: TW });
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
  // the projectile loop below draws each tracer along its own bore line into that plane.
  //
  // Everything here is sized against SOLDIER_H. One world unit is roughly 3.3 m (32 storeys of
  // STORY_H make the tower), so the gun is a ~3 m barrel on a chest-high mount — a weapon a man can
  // stand behind, not the eight-metre prop that used to sit here.
  const post = content.combat.gun.pivot; // arena-space firing column the sim spawns projectiles from
  const BARREL_LEN = SOLDIER_H * 1.55; // barrel length & muzzle reach (tip distance from the yaw pivot)
  /** Height of the gun's yaw pivot above the roof deck's top face — the soldier's chest. */
  const GUN_PIVOT_H = SOLDIER_H * 0.62;
  /**
   * Nominal engagement range, in arena units, that the barrel is pointed at.
   *
   * The simulation's aim is an ANGLE, not a target, so a range has to be chosen to turn it into the
   * point the barrel looks at. It only sets how much of the elevation is depression versus depth, and
   * the drones are engaged over roughly a third to two thirds of the arena's width, so the middle of
   * that band is the honest answer and nothing in the fight is sensitive to it.
   *
   * It is also the distance over which a tracer sheds its muzzle offset (see the projectile loop),
   * and that is not a coincidence: shedding it over exactly the range the barrel looks at is what
   * makes the drawn path the straight line from the muzzle to the aim point — the bore line.
   */
  const AIM_RANGE = 150;
  const gunPivot = new THREE.Group();
  gunPivot.position.set(ax(post.x), ROOF_DECK_TOP_Y + GUN_PIVOT_H, TOWER_Z);
  scene.add(gunPivot);

  // The gun itself lives in ./weapon: a receiver, a jacketed barrel, a belt and a tripod, with the
  // recoil rig already wired. `BARREL_LEN` is still the one number that sets its scale, and the
  // muzzle it reports is what the tracer offset below is measured from — so the flash and the first
  // visible tracer come from the same point, which they did not when both were guessed separately.
  const weapon = createWeapon(BARREL_LEN);
  gunPivot.add(weapon.group);
  const recoil = createRecoil();

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

  const barrelYaw = weapon.yaw;
  const barrelPitch = weapon.pitch;

  /**
   * Where the muzzle sits, and how the barrel must be turned, for a shot laid at arena angle `angle`.
   *
   * Written into a scratch record rather than returned, because the projectile loop calls it once per
   * round in flight and the render loop must not allocate.
   *
   * Both angles come out of ONE target point, on purpose. Setting the yaw from the arena angle and
   * then finding an elevation separately — which is what this did first — makes horizontal target
   * motion roll the barrel about the view axis instead of swinging it. Yaw about z sends the barrel's
   * +y to (−sin a, cos a, 0); pitching about the yawed frame's own x then gives
   * (−sin a·cos p, cos a·cos p, sin p). Reading that backwards from the direction to the target is
   * the whole solve: p = asin(z), a = atan2(−x, y).
   */
  const muzzle = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  function solveMuzzle(angle: number): void {
    // The point being shot at: out along the aim, down on the plane the drones live on. Arena angle θ
    // maps to world (cos θ, −sin θ) — arena y is down, world y is up.
    const dx = ax(post.x) + Math.cos(angle) * AIM_RANGE * AS - gunPivot.position.x;
    const dy = ay(post.y) - Math.sin(angle) * AIM_RANGE * AS - gunPivot.position.y;
    const dz = ACTION_Z - gunPivot.position.z;
    const len = Math.hypot(dx, dy, dz);
    const pitch = Math.asin(dz / len);
    const yaw = Math.atan2(-dx, dy);
    const reach = weapon.muzzleReach;
    const cosP = Math.cos(pitch);
    muzzle.yaw = yaw;
    muzzle.pitch = pitch;
    muzzle.x = gunPivot.position.x - reach * Math.sin(yaw) * cosP;
    muzzle.y = gunPivot.position.y + reach * Math.cos(yaw) * cosP;
    muzzle.z = gunPivot.position.z + reach * Math.sin(pitch);
  }

  // ---- The dressing around the post ------------------------------------------------------------
  const rooftop = createRooftop(scene, {
    x: towerX,
    z: TOWER_Z,
    deckTopY: ROOF_DECK_TOP_Y,
    width: TW,
    depth: TD,
    parapetHeight: PARAPET_H,
    unit: SOLDIER_H,
  });

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

  // ---- Pools: drones, projectiles, particles ---------------------------------------------------
  // `DRONE_CAPACITY` is a ceiling on what will be DRAWN, not on what the sim may spawn: the flight
  // hides surplus rather than refusing it, so an unexpected wave costs frames, never correctness.
  const DRONE_CAPACITY = 24;
  const drones = createDrones(scene, DRONE_CAPACITY);
  const sightings: DroneSighting[] = [];
  /** Drones drawn last frame, by id, as our OWN copies. What LEAVES this map is what stopped flying. */
  const lastSeen = new Map<number, { x: number; y: number; radius: number }>();
  const seenNow = new Set<number>();
  /** Last frame's damage per tower, so a rise can be spotted. See the strike block in the loop. */
  const prevCut = new Map<number, number>();
  /** Towers that took a hit this frame. Reused; never reallocated. */
  const struckNow: { id: number; x: number; width: number }[] = [];
  /**
   * Slack, in arena units, on "was this drone over that tower when it vanished?"
   *
   * A drone detonating against a roof is not exactly above its centre, and the alternative to a
   * tolerance is to plumb the sim's own target id through to the renderer for a cosmetic decision.
   * Erring wide is the cheap direction: the worst case is a kill scored right over a tower that was
   * being hit anyway showing dust instead of an airburst, in a frame where dust is already correct.
   */
  const STRIKE_REACH = 14;
  const vfx = createVfx(scene);
  const projGeo = new THREE.SphereGeometry(0.12, 6, 4);
  const projMat = new THREE.MeshBasicMaterial({ color: colorOf('flash') });
  /** Distance the tracer sphere is modelled at. See the scale in the projectile loop. */
  const PROJ_REF_DIST = TOWER_Z + 3 - ACTION_Z;
  const projPool: THREE.Mesh[] = [];

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
  // NOT optional, and its absence was a real bug: this camera is deliberately kept OUT of the scene
  // so no framing change can touch it, which also means the renderer never walks it and nothing else
  // will ever refresh its world matrix. `Raycaster.setFromCamera` reads exactly that matrix — for the
  // ray's origin AND for unprojecting its direction — so while it sat at the identity every pointer
  // aim was cast from the world origin looking down -z instead of from the soldier's eye. With the
  // action plane at z = 0 that ray began ON the plane, so the hit was the origin and EVERY pointer
  // position aimed at the same spot; the fault hid behind the keyboard controls the game is usually
  // driven by. One call is enough because the pose is fixed for the lifetime of the view.
  aimCamera.updateMatrixWorld(true);

  const ray = new THREE.Raycaster();
  const actionPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -ACTION_Z);
  let cssW = 1;
  let cssH = 1;

  // ---- Generated surface detail, if it turns up -----------------------------------------------
  // The world above is complete and correct with nothing but its palette colours, exactly as it was
  // before this existed. The build-time textures are layered on afterwards if they arrive; if they
  // do not, or if the tier says they are not worth their cost, the game is a little plainer and
  // nothing else. Presentation is allowed to arrive late; it is never allowed to hold up a frame.
  let detail: DetailTextures | null = null;
  let disposed = false;

  function applyDetail(textures: DetailTextures): void {
    for (const { material, size } of concreteSurfaces) {
      const set = textures.concreteFor(size);
      material.map = set.map;
      material.normalMap = set.normalMap;
      material.roughnessMap = set.roughnessMap;
      // Flat shading and a normal map are in direct conflict: flat shading discards the interpolated
      // normal the map exists to perturb. Now that there is real surface detail, it is the better of
      // the two, so it wins. (Box faces are flat in the geometry anyway, so silhouettes do not move.)
      material.flatShading = false;
      material.needsUpdate = true;
    }
    city.applyDetail(textures);
  }

  if (policy.detailTextures) {
    void loadDetailTextures(renderer.capabilities.getMaxAnisotropy()).then((textures) => {
      if (textures === null) return;
      if (disposed) {
        textures.dispose(); // the view went away while the fetch was in flight
        return;
      }
      detail = textures;
      applyDetail(textures);
    });
  }

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
  /** The gun's cooldown as of the previous frame; a rise in it is a shot having been fired. */
  let lastFireCooldown = 0;
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
    hemi.intensity = rig.hemisphere;
    sun.intensity = rig.key;
    mixInto(sun.color, rig.keyColor.from, rig.keyColor.to, rig.keyColor.t);
    renderer.toneMappingExposure = rig.exposure;

    // The sun travels. Its bearing comes from the cycle rather than from `daylight`, which is a
    // cosine and so cannot tell morning from afternoon; the light is placed relative to the rooftop
    // so it stays inside the shadow camera's frustum however far round it has swung.
    const dir = sunDirectionFor(dayCycleAt(now, content.combat.difficulty));
    sunDir.set(dir.x, dir.y, dir.z);
    sun.position
      .set(TOWER_X, ROOF_DECK_TOP_Y, TOWER_Z)
      .addScaledVector(sunDir, SUN_DISTANCE);

    skyView.update(rig, sunDir, policy);
    if (scene.fog) mixInto(scene.fog.color, rig.fogColor.from, rig.fogColor.to, rig.fogColor.t);

    // Skyline damage and the night glow. Both are the city's business; see ./city for how "this
    // tower has lost four floors" became one integer instead of a hundred visibility flags.
    city.update(c.skyline.buildings, rig.windowGlow, dt);

    // Which towers took a hit THIS frame.
    //
    // Diffed rather than subscribed to. The sim does emit `buildingDamaged`, but this view is a pure
    // consumer of state by design — it is handed a GameState and nothing else — and `cut` rising is
    // the same fact, available without threading an event bus through the renderer. Only a RISE
    // counts: repairs lower it, and a tower being rebuilt must not throw dust.
    struckNow.length = 0;
    for (const b of c.skyline.buildings) {
      const before = prevCut.get(b.id);
      prevCut.set(b.id, b.cut);
      if (before === undefined || b.cut <= before) continue;
      struckNow.push(b);
      const at = city.strike(b.id);
      if (at) vfx.strike(at.x, at.y, at.z, 1 + (b.cut - before) * 0.4);
    }

    // Drones. Silhouettes and rotors are ./drones' business; what this loop owns is the mapping from
    // arena space into the action plane, and noticing that a drone the sim was drawing last frame is
    // gone this frame — which is the only signal the render side gets that something was destroyed.
    sightings.length = 0;
    seenNow.clear();
    for (const d of c.drones) {
      seenNow.add(d.id);
      // A COPY. The sim recycles drone objects, so holding the live one means that by the time this
      // map is read — one frame later, to explode something that no longer exists — the position it
      // reports may belong to whatever drone was issued the slot next.
      const last = lastSeen.get(d.id);
      if (last) {
        last.x = d.pos.x;
        last.y = d.pos.y;
        last.radius = d.radius;
      } else {
        lastSeen.set(d.id, { x: d.pos.x, y: d.pos.y, radius: d.radius });
      }
      sightings.push({
        kind: d.kind,
        x: ax(d.pos.x),
        y: ay(d.pos.y),
        z: ACTION_Z,
        radius: d.radius,
        colorTag: d.colorTag !== undefined,
      });
    }
    for (const [id, d] of lastSeen) {
      if (seenNow.has(id)) continue;
      lastSeen.delete(id);
      // A drone leaves the list for two very different reasons: the player shot it down, or it got
      // through and went off against a tower. Those used to look identical, which meant the one
      // thing the player most needs to know — did I stop it? — was not on screen anywhere. Now a
      // vanishing over a tower that just lost floors is the tower's story, and the dust above
      // already tells it; anything else was a kill and gets its airburst.
      if (struckNow.some((b) => Math.abs(d.x - b.x) < b.width / 2 + d.radius + STRIKE_REACH)) continue;
      vfx.explode(ax(d.x), ay(d.y), ACTION_Z, d.radius / 5);
    }
    drones.update(sightings, now);
    vfx.advance(dt);

    // Gun aim. The barrel models +y at rest and it is now pointed at a POINT in three dimensions
    // rather than turned to an angle in the screen plane, because those stopped being the same thing
    // the moment the drones moved back onto the city: the post stands 26 units in FRONT of the plane
    // they fly on, so a barrel that only ever rolled in the screen plane pointed somewhere no round
    // ever went. `solveMuzzle` does the decomposition; see it for why both angles come from one point.
    gunPivot.visible = vs.mode === 'shooting';
    solveMuzzle(c.aim.effectiveAngle);
    barrelYaw.rotation.z = muzzle.yaw;
    barrelPitch.rotation.x = muzzle.pitch;
    // One kick per SHOT, not per firing frame. `fireCooldown` is reset upward by the sim the instant
    // a round leaves, so a rise in it is the only per-shot edge the render side can see — and it is
    // exact at every fire rate, which "firing && a timer" never was: at 12 rounds a second the old
    // flash was simply on, continuously, and the gun never appeared to cycle.
    if (c.gun.fireCooldown > lastFireCooldown + 1e-6) kickRecoil(recoil);
    lastFireCooldown = c.gun.fireCooldown;
    advanceRecoil(recoil, dt);
    weapon.update(recoil, reducedFlash);

    // Projectiles. The sim flies them from the firing column in arena 2D, which is the round's shadow
    // on the drones' plane; the gun that fired them stands 26 units nearer the camera, on the roof. So
    // each tracer is drawn on the line joining the two — from the muzzle, through the air, down onto
    // its shadow — by carrying the full muzzle offset at the barrel and shedding it linearly out to
    // AIM_RANGE, where the barrel is looking and where the offset reaches zero. Both ends move
    // linearly with range, so what is drawn is a straight line: the bore line, and the round is on it.
    //
    // Two things this must NOT do, both of them tried:
    //
    //  - Take the offset from the CURRENT aim. Every round in the air then swings sideways with the
    //    barrel, and a gun tracking across the sky drags its whole stream after it in a great arc —
    //    the "rainbow". Each round is laid on the angle it was actually FIRED at instead, which its
    //    own velocity records exactly and nothing later can disturb.
    //  - Shed the offset over some short distance instead of the full range. That is a straight line
    //    too, but a much steeper one, and it meets the flat part in a hard kink a few frames out. With
    //    the muzzle only three units from the lens that first stub is enormously magnified: a round
    //    fired to the LEFT appeared to set off to the right and then turn.
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
      solveMuzzle(Math.atan2(p.vel.y, p.vel.x));
      const planeZ = ACTION_Z + 0.2;
      const k = 1 - Math.min(1, Math.hypot(p.pos.x - post.x, p.pos.y - post.y) / AIM_RANGE);
      m.position.set(
        ax(p.pos.x) + (muzzle.x - ax(post.x)) * k,
        ay(p.pos.y) + (muzzle.y - ay(post.y)) * k,
        planeZ + (muzzle.z - planeZ) * k,
      );
      // Held to a constant APPARENT size. Early in its flight a round is metres from the lens rather
      // than out over the city, and a fixed-radius sphere there is not a tracer — it is a white
      // balloon across a fifth of the screen. Scaling by its own distance cancels the perspective
      // divide, so what leaves the barrel is the same speck that reaches the target.
      const near = m.position.distanceTo(camera.position);
      m.scale.setScalar(Math.max(0.12, near / PROJ_REF_DIST));
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
      // renderer after we have gone. `disposed` does the same for the texture fetch.
      chainToken += 1;
      disposed = true;
      soldier.dispose();
      skyView.dispose();
      city.dispose();
      rooftop.dispose();
      weapon.dispose();
      drones.dispose();
      vfx.dispose();
      detail?.dispose();
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
