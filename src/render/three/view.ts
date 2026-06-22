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
import { PALETTE } from '../palette';
import type { PaletteKey } from '../palette';
import { daylightAt } from '../../core/difficulty';
import type { Content } from '../../content/loader';
import type { GameState } from '../../state/game-state';
import type { PlayingViewState } from '../../state/playing-view';
import type { Vec2 } from '../../core/math';

export interface ThreeView {
  /** Resize the renderer to the CSS viewport (rendered at the device's native pixel ratio). */
  resize(cssW: number, cssH: number): void;
  /** Canvas-relative pixel → 384×216 arena coordinate (for aiming). Uses the fixed shooting camera. */
  screenToWorld(canvasX: number, canvasY: number): Vec2;
  /** Draw one frame from the current state + interaction view model. */
  render(gs: GameState, alpha: number, vs: PlayingViewState): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}

// ---- Arena → world mapping ------------------------------------------------------------------
const ARENA_W = 384;
const ARENA_CX = ARENA_W / 2;
const POST_Y = 196; // arena y of the firing post (gun pivot) — maps to the tower roof
const AS = 0.09; // arena px → world units
const STORY_H = 0.95; // world height of one tower storey
const ROOF_Y = 32 * STORY_H; // the soldier tower roof (gun height) in world units
const ACTION_Z = 0; // the plane drones/gun/projectiles live on (exact aim raycast target)
const SKYLINE_Z = -16; // far Moscow skyline depth
const TOWER_Z = 3.2; // the soldier's foreground tower depth (in front of the action plane)

function ax(x: number): number {
  return (x - ARENA_CX) * AS;
}
function ay(y: number): number {
  return ROOF_Y + (POST_Y - y) * AS;
}
function col(key: PaletteKey): THREE.Color {
  return new THREE.Color(PALETTE[key]);
}

const NOOP_VIEW: ThreeView = {
  resize() {},
  screenToWorld: () => ({ x: ARENA_CX, y: POST_Y }),
  render() {},
  setVisible() {},
  dispose() {},
};

interface SkylineTower {
  buildingId: number;
  slabs: THREE.Mesh[]; // bottom → top; the top `floor(cut)` are hidden
}

export function createThreeView(canvas: HTMLCanvasElement, content: Content): ThreeView {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch {
    return NOOP_VIEW; // no WebGL (headless/unsupported) — keep the sim running renderer-less
  }
  renderer.setPixelRatio(Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1, 3));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 400);
  // A fixed camera at the shooting pose, used ONLY for the aim raycast so screenToWorld never drifts
  // while the render camera lerps into the interior.
  const aimCamera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 400);

  // ---- Lights + sky -------------------------------------------------------------------------
  const hemi = new THREE.HemisphereLight(0xffffff, 0x223044, 1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(-8, 30, 14);
  scene.add(sun);

  const skyGeo = new THREE.SphereGeometry(220, 24, 16);
  const skyMat = new THREE.MeshBasicMaterial({ color: col('skyDayTop'), side: THREE.BackSide, fog: false });
  scene.add(new THREE.Mesh(skyGeo, skyMat));

  const sunSprite = new THREE.Mesh(
    new THREE.CircleGeometry(7, 24),
    new THREE.MeshBasicMaterial({ color: col('flash') }),
  );
  sunSprite.position.set(40, ROOF_Y + 26, -120);
  scene.add(sunSprite);

  // Ground haze plane (reads as the distant city floor).
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(600, 200),
    new THREE.MeshStandardMaterial({ color: col('ink') }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, ay(content.combat.skyline.groundY), -40);
  scene.add(ground);

  // ---- Far layer: damageable Moscow skyline -------------------------------------------------
  const skylineGroup = new THREE.Group();
  scene.add(skylineGroup);
  const towers: SkylineTower[] = [];
  const windowGeo = new THREE.PlaneGeometry(0.5, 0.5);
  for (const b of content.combat.skyline.buildings) {
    const baseY = ay(content.combat.skyline.groundY);
    const slabH = (b.height * AS) / b.stories;
    const w = b.width * AS;
    const slabs: THREE.Mesh[] = [];
    const body = col(b.id % 2 === 0 ? 'concrete' : 'concreteDk');
    for (let s = 0; s < b.stories; s++) {
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(w, slabH * 0.96, w * 0.7),
        new THREE.MeshStandardMaterial({ color: body, flatShading: true }),
      );
      slab.position.set(ax(b.x), baseY + slabH * (s + 0.5), SKYLINE_Z);
      // Lit windows on the camera-facing side (emissive so night reads).
      const win = new THREE.Mesh(
        windowGeo,
        new THREE.MeshStandardMaterial({ color: col('windowLit'), emissive: col('windowLit'), emissiveIntensity: 0.8 }),
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
  const TW = 60 * AS; // tower footprint width
  const TD = 26 * AS; // depth
  const towerBaseY = ay(content.combat.skyline.groundY);
  const towerX = ax(ARENA_CX);
  // Back + side walls (front omitted → the cut-away reveals the floors).
  const wallMat = new THREE.MeshStandardMaterial({ color: col('concreteDk'), flatShading: true });
  const back = new THREE.Mesh(new THREE.BoxGeometry(TW, ROOF_Y, 0.2), wallMat);
  back.position.set(towerX, towerBaseY + ROOF_Y / 2, TOWER_Z - TD / 2);
  towerGroup.add(back);
  for (const sx of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.2, ROOF_Y, TD), wallMat);
    side.position.set(towerX + (sx * TW) / 2, towerBaseY + ROOF_Y / 2, TOWER_Z);
    towerGroup.add(side);
  }
  // Floor slabs + a highlight strip per floor (lets the current floor glow in interior mode).
  const floorHi: THREE.Mesh[] = []; // index 1..32 (floor number); 0 unused
  floorHi.length = 33;
  const occupantByFloor = new Map(content.economy.roster.map((r) => [r.floor, r] as const));
  for (let f = 1; f <= 32; f++) {
    const y = towerBaseY + (f - 1) * STORY_H;
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(TW, 0.12, TD),
      new THREE.MeshStandardMaterial({ color: col('shadow'), flatShading: true }),
    );
    deck.position.set(towerX, y, TOWER_Z);
    towerGroup.add(deck);
    // A dim back-glow panel for the floor (brightened when this floor is being visited).
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(TW * 0.92, STORY_H * 0.86),
      new THREE.MeshStandardMaterial({ color: col('windowLit'), emissive: col('windowLit'), emissiveIntensity: 0.12 }),
    );
    glow.position.set(towerX, y + STORY_H / 2, TOWER_Z - TD / 2 + 0.12);
    towerGroup.add(glow);
    floorHi[f] = glow;
    // A resident marker (little figure) on occupied floors.
    const occ = occupantByFloor.get(f);
    if (occ) {
      const fig = new THREE.Mesh(
        new THREE.CapsuleGeometry(STORY_H * 0.16, STORY_H * 0.4, 4, 8),
        new THREE.MeshStandardMaterial({ color: col('skin'), flatShading: true }),
      );
      fig.position.set(towerX - TW * 0.28, y + STORY_H * 0.42, TOWER_Z + TD * 0.18);
      towerGroup.add(fig);
    }
  }

  // ---- The gun + soldier on the roof --------------------------------------------------------
  const gunPivot = new THREE.Group();
  gunPivot.position.set(ax(content.combat.gun.pivot.x), ROOF_Y, ACTION_Z);
  scene.add(gunPivot);
  const soldier = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.5, 1.1, 4, 8),
    new THREE.MeshStandardMaterial({ color: col('uniform'), flatShading: true }),
  );
  soldier.position.set(-0.6, 0.4, 0);
  gunPivot.add(soldier);
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.18, 2.4, 8),
    new THREE.MeshStandardMaterial({ color: col('gunmetal'), flatShading: true }),
  );
  barrel.geometry.translate(0, 1.2, 0); // pivot at one end
  const barrelYaw = new THREE.Group();
  barrelYaw.add(barrel);
  gunPivot.add(barrelYaw);
  const muzzle = new THREE.Mesh(
    new THREE.SphereGeometry(0.45, 8, 6),
    new THREE.MeshBasicMaterial({ color: col('flashHot') }),
  );
  muzzle.visible = false;
  barrelYaw.add(muzzle);

  // ---- Pools: drones + projectiles ----------------------------------------------------------
  const droneGeo = new THREE.IcosahedronGeometry(0.55, 0);
  const dronePool: THREE.Mesh[] = [];
  const projGeo = new THREE.SphereGeometry(0.12, 6, 4);
  const projMat = new THREE.MeshBasicMaterial({ color: col('flash') });
  const projPool: THREE.Mesh[] = [];

  function droneColorKey(kind: string): PaletteKey {
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

  // ---- Camera poses -------------------------------------------------------------------------
  const shootEye = new THREE.Vector3(0, ROOF_Y + 3.2, 26);
  const shootLook = new THREE.Vector3(0, ROOF_Y + 6, ACTION_Z);
  aimCamera.position.copy(shootEye);
  aimCamera.lookAt(shootLook);

  const ray = new THREE.Raycaster();
  const actionPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -ACTION_Z);
  let cssW = 1;
  let cssH = 1;

  // Smoothed camera lerp factor: 0 = shooting, 1 = interior.
  let camT = 0;

  function updateCamera(vs: PlayingViewState, dt: number): void {
    const target = vs.mode === 'interior' ? 1 : 0;
    camT += (target - camT) * Math.min(1, dt * 6);
    const floorY = towerBaseY + (vs.floor - 1) * STORY_H + STORY_H / 2;
    const inEye = new THREE.Vector3(towerX, floorY + 1.2, TOWER_Z + 9);
    const inLook = new THREE.Vector3(towerX, floorY, TOWER_Z);
    camera.position.lerpVectors(shootEye, inEye, camT);
    const look = new THREE.Vector3().lerpVectors(shootLook, inLook, camT);
    camera.lookAt(look);
  }

  let lastT = 0;
  let muzzleTimer = 0;

  function render(gs: GameState, _alpha: number, vs: PlayingViewState): void {
    const c = gs.combat;
    const now = gs.time.shiftSeconds;
    const dt = Math.max(0, Math.min(0.1, now - lastT));
    lastT = now;

    // Day / night.
    const daylight = daylightAt(now, content.combat.difficulty);
    skyMat.color.copy(col('skyDayTop')).lerp(col('skyNightTop'), 1 - daylight);
    hemi.intensity = 0.35 + daylight * 0.75;
    sun.intensity = 0.3 + daylight * 0.9;
    sunSprite.material.color.copy(daylight > 0.4 ? col('flash') : col('cloud'));
    const winGlow = 0.25 + (1 - daylight) * 1.1;

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
        m.material.color.copy(col(d.colorTag !== undefined ? 'accentPink' : droneColorKey(d.kind)));
      }
    }
    for (let i = c.drones.length; i < dronePool.length; i++) {
      const m = dronePool[i];
      if (m) m.visible = false;
    }

    // Projectiles.
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
      m.position.set(ax(p.pos.x), ay(p.pos.y), ACTION_Z + 0.2);
    }
    for (let i = c.projectiles.length; i < projPool.length; i++) {
      const m = projPool[i];
      if (m) m.visible = false;
    }

    // Gun aim + muzzle flash. Arena angle θ (down = +y); world up = -arena y, so rotate by -θ.
    barrelYaw.rotation.z = -c.aim.effectiveAngle;
    if (c.gun.firing && !c.gun.overheated && !c.gun.jammed) {
      muzzleTimer = 0.05;
      const reach = 2.4;
      muzzle.position.set(0, reach, 0);
    }
    muzzleTimer = Math.max(0, muzzleTimer - dt);
    muzzle.visible = muzzleTimer > 0;

    // Highlight the floor being visited.
    for (let f = 1; f <= 32; f++) {
      const glow = floorHi[f];
      if (glow && glow.material instanceof THREE.MeshStandardMaterial) {
        const lit = vs.mode === 'interior' && f === vs.floor;
        glow.material.emissiveIntensity = lit ? 0.95 : 0.12 + (1 - daylight) * 0.25;
      }
    }

    updateCamera(vs, dt);
    renderer.render(scene, camera);
  }

  function resize(w: number, h: number): void {
    cssW = Math.max(1, w);
    cssH = Math.max(1, h);
    renderer.setSize(cssW, cssH, false);
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
    return { x: hit.x / AS + ARENA_CX, y: POST_Y - (hit.y - ROOF_Y) / AS };
  }

  return {
    resize,
    screenToWorld,
    render,
    setVisible(visible: boolean): void {
      canvas.style.display = visible ? 'block' : 'none';
    },
    dispose(): void {
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
