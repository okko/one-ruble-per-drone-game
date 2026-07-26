import * as THREE from 'three';
import { colorOf } from './theme';
import { flashRoll, flashScale, type RecoilState } from './recoil';

/**
 * The rooftop machine gun.
 *
 * What stood here was one eight-sided cylinder and a sphere that blinked. The gun is dead centre of
 * the frame in the shooting pose and it is what the player is *doing*, so it earns real geometry:
 * a receiver, a jacketed barrel, a muzzle brake, spade grips, a belt of rounds feeding out of a can,
 * and a tripod holding the whole thing on the deck. It is a DShK in silhouette — the gun a Moscow
 * roof would actually have — without pretending to be a scale model of one.
 *
 * Everything is sized from `barrelLength`, which the caller derives from the soldier's own height.
 * That is not tidiness: a man here is 0.58 world units, so any measurement written in metres would
 * be an order of magnitude wrong and the gun would end up either a rifle or a naval turret.
 *
 * The recoil rig is a group inside the yaw group, translated back along the barrel. Putting it there
 * rather than moving the parts individually means the flash, the brake and the belt all move with
 * the receiver for free, which is what makes the kick read as one mechanism instead of a wobble.
 *
 * Draw calls: the jacket rings and the belt rounds are single instanced meshes, and the rest shares
 * two materials, so the whole weapon is about seven calls whatever its detail.
 */

/** Rings up the cooling jacket. The one detail that says "heavy machine gun" at a glance. */
const JACKET_RINGS = 9;

/** Rounds drawn in the belt hanging from the feed tray to the ammunition can. */
const BELT_ROUNDS = 14;

export interface WeaponRig {
  /** Mounts at the gun's yaw pivot; the caller positions this. */
  readonly group: THREE.Group;
  /** Rotated about z to aim. The barrel models along +y, as the old one did. */
  readonly yaw: THREE.Group;
  /** Distance from the yaw pivot to the muzzle, along +y in yaw space, at rest. */
  readonly muzzleReach: number;
  /** Push the current recoil and flash state into the rig. Allocation-free. */
  update(recoil: RecoilState, reducedFlash: boolean): void;
  dispose(): void;
}

/**
 * A catenary-ish belt hanging from the feed tray to the can.
 *
 * Hand-evaluated rather than swept with `TubeGeometry`, which would drag three's curve and
 * triangulation stack into the bundle for what is fourteen little boxes on a parabola — the same
 * twelve-kilobyte lesson the Kremlin star taught.
 */
function beltPoint(t: number, out: THREE.Vector3, span: number, drop: number): void {
  out.set(0, -t * span, -drop * (0.18 + 4 * t * (1 - t)));
}

export function createWeapon(barrelLength: number): WeaponRig {
  const group = new THREE.Group();
  const yaw = new THREE.Group();
  group.add(yaw);
  /** Moves back along the barrel under recoil; everything that fires is a child of it. */
  const recoiling = new THREE.Group();
  yaw.add(recoiling);

  const L = barrelLength;
  const bore = L * 0.042;
  const jacketR = L * 0.062;
  const brakeLen = L * 0.11;
  const muzzleReach = L + brakeLen;

  // Barely metallic on purpose. A `metalness` near 1 has almost no diffuse term, so a metal surface
  // is *entirely* its reflection — and on the tiers that cannot afford an environment map (and in
  // any direction the key light does not reach) that reflection is nothing at all, which is how the
  // first version of this gun came out as a black stick against the sky. Roughness carries the
  // steel read instead, and it costs nothing.
  const steel = new THREE.MeshStandardMaterial({
    color: colorOf('gunmetal').clone().lerp(colorOf('cloud'), 0.28),
    metalness: 0.3,
    roughness: 0.45,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: colorOf('gunmetalDk'),
    metalness: 0.25,
    roughness: 0.6,
  });
  const brass = new THREE.MeshStandardMaterial({
    color: colorOf('rubleGold'),
    metalness: 0.45,
    roughness: 0.35,
  });

  const owned: (THREE.BufferGeometry | THREE.Material)[] = [steel, dark, brass];
  function keep<T extends THREE.BufferGeometry>(geometry: T): T {
    owned.push(geometry);
    return geometry;
  }

  // ---- Receiver, barrel, brake ---------------------------------------------------------------
  const receiver = new THREE.Mesh(
    keep(new THREE.BoxGeometry(L * 0.13, L * 0.42, L * 0.15)),
    dark,
  );
  receiver.position.y = L * 0.12;
  recoiling.add(receiver);

  const barrel = new THREE.Mesh(keep(new THREE.CylinderGeometry(bore, bore * 1.15, L, 10)), steel);
  barrel.position.y = L * 0.5;
  recoiling.add(barrel);

  // The jacket: one instanced ring repeated up the barrel. Perforated in silhouette, one draw call.
  const ring = new THREE.InstancedMesh(
    keep(new THREE.CylinderGeometry(jacketR, jacketR, L * 0.035, 10, 1, true)),
    steel,
    JACKET_RINGS,
  );
  ring.frustumCulled = false;
  const m = new THREE.Matrix4();
  for (let i = 0; i < JACKET_RINGS; i += 1) {
    const t = (i + 0.5) / JACKET_RINGS;
    m.makeTranslation(0, L * (0.22 + t * 0.62), 0);
    ring.setMatrixAt(i, m);
  }
  recoiling.add(ring);

  const brake = new THREE.Mesh(
    keep(new THREE.CylinderGeometry(jacketR * 1.25, jacketR * 0.9, brakeLen, 8)),
    dark,
  );
  brake.position.y = L + brakeLen / 2;
  recoiling.add(brake);

  // ---- Feed: can, belt, spade grips ----------------------------------------------------------
  const can = new THREE.Mesh(keep(new THREE.BoxGeometry(L * 0.2, L * 0.16, L * 0.22)), dark);
  can.position.set(0, -L * 0.22, -L * 0.16);
  recoiling.add(can);

  const belt = new THREE.InstancedMesh(
    keep(new THREE.BoxGeometry(L * 0.05, L * 0.03, L * 0.018)),
    brass,
    BELT_ROUNDS,
  );
  belt.frustumCulled = false;
  const p = new THREE.Vector3();
  for (let i = 0; i < BELT_ROUNDS; i += 1) {
    beltPoint((i + 0.5) / BELT_ROUNDS, p, L * 0.34, L * 0.24);
    m.makeTranslation(0, receiver.position.y + p.y, p.z);
    belt.setMatrixAt(i, m);
  }
  recoiling.add(belt);

  const gripGeo = keep(new THREE.BoxGeometry(L * 0.035, L * 0.16, L * 0.035));
  for (const sx of [-1, 1]) {
    const grip = new THREE.Mesh(gripGeo, dark);
    grip.position.set(sx * L * 0.1, -L * 0.12, L * 0.06);
    grip.rotation.x = 0.35;
    recoiling.add(grip);
  }

  // A rear sight, so the back of the gun is not a blank box in the shooting framing.
  const sight = new THREE.Mesh(keep(new THREE.BoxGeometry(L * 0.012, L * 0.09, L * 0.012)), steel);
  sight.position.set(0, L * 0.06, L * 0.09);
  recoiling.add(sight);

  // ---- Muzzle flash --------------------------------------------------------------------------
  // Geometric, not a sprite: a cone of burning gas with a hot core. A textured billboard would be
  // softer, but it would also be one more thing that has to have loaded before the gun looks right,
  // and the flash is on screen for fifty-five milliseconds. Additive and unlit, so tone mapping can
  // take it genuinely bright without punching a white hole (§3.6).
  const flashMat = new THREE.MeshBasicMaterial({
    color: colorOf('flashHot'),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  owned.push(flashMat);
  const flash = new THREE.Group();
  flash.position.y = muzzleReach;
  flash.visible = false;
  recoiling.add(flash);
  const jetGeo = keep(new THREE.ConeGeometry(jacketR * 2.6, L * 0.55, 6, 1, true));
  const jet = new THREE.Mesh(jetGeo, flashMat);
  jet.position.y = L * 0.275;
  flash.add(jet);
  const core = new THREE.Mesh(keep(new THREE.IcosahedronGeometry(jacketR * 2.2, 0)), flashMat);
  flash.add(core);
  // A one-frame light pop. This is what makes the gun light the deck and the soldier's face rather
  // than glowing on its own — and it is why the flash is worth having at all in the dark.
  const flashLight = new THREE.PointLight(colorOf('flash'), 0, L * 6, 2);
  flash.add(flashLight);

  // ---- Tripod ---------------------------------------------------------------------------------
  // Outside the yaw group: the mount does not turn with the gun, which is the difference between a
  // weapon on a stand and a weapon growing out of the floor.
  const pintle = new THREE.Mesh(keep(new THREE.CylinderGeometry(L * 0.05, L * 0.06, L * 0.2, 8)), dark);
  pintle.position.y = -L * 0.1;
  group.add(pintle);
  const legGeo = keep(new THREE.CylinderGeometry(L * 0.016, L * 0.022, 1, 6));
  legGeo.translate(0, -0.5, 0); // hang from the top, so scaling y sets the reach downward
  for (let i = 0; i < 3; i += 1) {
    const leg = new THREE.Mesh(legGeo, steel);
    // Two legs forward, one back: a tripod facing the way the gun does.
    const bearing = (i / 3) * Math.PI * 2 + Math.PI / 2;
    leg.position.y = -L * 0.16;
    leg.rotation.order = 'YXZ';
    leg.rotation.y = bearing;
    leg.rotation.x = 0.42;
    leg.scale.y = L * 0.5;
    group.add(leg);
  }

  return {
    group,
    yaw,
    muzzleReach,
    update(recoil: RecoilState, reducedFlash: boolean): void {
      // Recoil travels back down the barrel, which is -y in the gun's own space.
      recoiling.position.y = -recoil.offset * L * 0.09;
      const lit = recoil.flash > 0;
      flash.visible = lit;
      if (!lit) {
        flashLight.intensity = 0;
        return;
      }
      const s = recoil.flash * flashScale(recoil.shots);
      flash.scale.setScalar(s);
      flash.rotation.y = flashRoll(recoil.shots);
      flashMat.opacity = recoil.flash;
      // Reduced flash keeps the shape (you must still see that you are firing) and drops the light
      // pop, which is the part that actually strobes the whole frame (§8 photosensitivity).
      flashLight.intensity = reducedFlash ? 0 : recoil.flash * L * 14;
    },
    dispose(): void {
      group.removeFromParent();
      for (const o of owned) o.dispose();
      ring.dispose();
      belt.dispose();
    },
  };
}
