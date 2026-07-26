import * as THREE from 'three';
import { colorOf } from './theme';

/**
 * The clutter that makes the rooftop a position rather than a platform.
 *
 * A bare deck with a gun on it reads as a diorama. What sells "somebody has been made to live up
 * here" is the stuff around the gun: sandbags heaped on the parapet, ammunition crates, a heap of
 * spent brass under the feed, a field radio. None of it is interactive and none of it is in the
 * simulation — it exists purely so the frame has somewhere for the eye to go besides the drone.
 *
 * Everything scattered is a single `InstancedMesh` per kind, laid out from a hash of its own index,
 * so the whole dressing is four draw calls and identical on every machine and every run. Determinism
 * matters here for the same reason it does everywhere else in this renderer: a frame that differs
 * run to run cannot be compared, and comparing frames is how the render gates work.
 */

/**
 * Spacing between sandbag centres along a rail, as a fraction of `unit`.
 *
 * A COUNT per side was the obvious thing and it was wrong: the deck is more than twice as wide as
 * it is deep, so thirteen bags a side packed the two short rails shoulder to shoulder and strung the
 * long back rail out into a dotted line of lumps floating over the parapet. Spacing is the property
 * that has to be constant — the number of bags is whatever the rail is long enough to hold.
 *
 * It is set just under a bag's own width (`bagR * 1.375` gives the half-length, so a bag is about
 * 0.30 units across) so neighbours touch and overlap slightly, which is how a heaped row reads as a
 * wall rather than as beads on a string.
 */
const BAG_PITCH = 0.28;
/** Fraction of each rail the bags are laid along, leaving the corners to the rails themselves. */
const BAG_SPAN_FRACTION = 0.94;
const BRASS_COUNT = 22;

function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export interface RooftopOptions {
  /** Centre of the deck, and the y of its top face — everything sits on or above this. */
  x: number;
  z: number;
  deckTopY: number;
  width: number;
  depth: number;
  /** Height of the parapet rails the sandbags are heaped onto. */
  parapetHeight: number;
  /** The scene's human unit (the soldier's height). Every size below is a fraction of it. */
  unit: number;
}

export interface RooftopProps {
  dispose(): void;
}

export function createRooftop(scene: THREE.Scene, options: RooftopOptions): RooftopProps {
  const { x, z, deckTopY, width, depth, parapetHeight, unit } = options;
  const group = new THREE.Group();
  scene.add(group);

  const owned: (THREE.BufferGeometry | THREE.Material)[] = [];
  function keep<T extends THREE.BufferGeometry | THREE.Material>(thing: T): T {
    owned.push(thing);
    return thing;
  }

  const burlap = keep(
    new THREE.MeshStandardMaterial({ color: colorOf('uniform'), roughness: 0.95, flatShading: true }),
  );
  const crateMat = keep(
    new THREE.MeshStandardMaterial({ color: colorOf('uniformDk'), roughness: 0.85, flatShading: true }),
  );
  const brassMat = keep(
    new THREE.MeshStandardMaterial({ color: colorOf('rubleGold'), metalness: 0.45, roughness: 0.4 }),
  );
  const gearMat = keep(
    new THREE.MeshStandardMaterial({ color: colorOf('gunmetalDk'), metalness: 0.25, roughness: 0.65 }),
  );

  // ---- Sandbags -------------------------------------------------------------------------------
  // Heaped along the three parapet rails, two courses, each bag squashed and turned a little. A bag
  // is a low-poly sphere rather than a box because the ROUNDNESS is the whole read: a row of boxes
  // on a wall is a wall, a row of lumps is sandbags.
  const bagGeo = keep(new THREE.SphereGeometry(1, 6, 4));
  const bagR = unit * 0.11;
  // How many bags each rail holds is derived from its own length, not shared between them — see
  // BAG_PITCH. Two is the floor so a rail is never a single lonely bag.
  const sides = [
    { dx: 0, dz: -depth / 2, ax: 1, az: 0, span: width },
    { dx: -width / 2, dz: 0, ax: 0, az: 1, span: depth },
    { dx: width / 2, dz: 0, ax: 0, az: 1, span: depth },
  ].map((side) => ({
    ...side,
    count: Math.max(2, Math.round((side.span * BAG_SPAN_FRACTION) / (BAG_PITCH * unit))),
  }));
  const courses = 2;
  const bagCount = sides.reduce((total, side) => total + side.count * courses, 0);
  const bags = new THREE.InstancedMesh(bagGeo, burlap, bagCount);
  bags.frustumCulled = false;
  bags.castShadow = true;
  bags.receiveShadow = true;
  const quat = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const m = new THREE.Matrix4();
  let n = 0;
  for (let s = 0; s < sides.length; s += 1) {
    const side = sides[s];
    if (!side) continue; // unreachable: `s` indexes an array built just above, sized by its own map
    for (let course = 0; course < courses; course += 1) {
      for (let i = 0; i < side.count; i += 1) {
        const seed = s * 977 + course * 131 + i;
        const r = hash(seed);
        // Odd courses are offset half a bag, the way anything stacked by hand ends up.
        const t = (i + 0.5 + (course % 2) * 0.5) / side.count - 0.5;
        const along = t * side.span * BAG_SPAN_FRACTION;
        pos.set(
          x + side.dx + side.ax * along + side.az * (r - 0.5) * bagR * 0.5,
          deckTopY + parapetHeight + bagR * (0.55 + course * 0.85),
          z + side.dz + side.az * along + side.ax * (r - 0.5) * bagR * 0.5,
        );
        euler.set((r - 0.5) * 0.3, hash(seed + 7) * Math.PI, (hash(seed + 13) - 0.5) * 0.5);
        quat.setFromEuler(euler);
        scale.set(bagR * (1.25 + r * 0.25), bagR * 0.62, bagR * (0.85 + r * 0.2));
        bags.setMatrixAt(n, m.compose(pos, quat, scale));
        n += 1;
      }
    }
  }
  group.add(bags);

  // ---- Ammunition crates ----------------------------------------------------------------------
  const crateGeo = keep(new THREE.BoxGeometry(unit * 0.34, unit * 0.19, unit * 0.22));
  const crateSpots = [
    [-0.3, 0.26, 0],
    [-0.36, 0.18, 1],
    [0.3, 0.3, 2],
  ] as const;
  for (const [fx, fz, i] of crateSpots) {
    const crate = new THREE.Mesh(crateGeo, crateMat);
    crate.position.set(x + fx * width, deckTopY + unit * (0.095 + (i === 1 ? 0.19 : 0)), z + fz * depth);
    crate.rotation.y = (hash(i * 31 + 5) - 0.5) * 0.7;
    crate.castShadow = true;
    crate.receiveShadow = true;
    group.add(crate);
  }

  // ---- Spent brass ----------------------------------------------------------------------------
  // Under and forward of the feed, where an ejection port would throw it. Small, but it is the one
  // prop that says the gun has been used, and it catches the muzzle flash beautifully.
  const caseGeo = keep(new THREE.CylinderGeometry(unit * 0.012, unit * 0.012, unit * 0.05, 5));
  const brass = new THREE.InstancedMesh(caseGeo, brassMat, BRASS_COUNT);
  brass.frustumCulled = false;
  brass.castShadow = true;
  for (let i = 0; i < BRASS_COUNT; i += 1) {
    const a = hash(i * 17 + 3) * Math.PI * 2;
    const rad = Math.sqrt(hash(i * 29 + 11)) * unit * 0.42;
    pos.set(x + Math.cos(a) * rad + unit * 0.2, deckTopY + unit * 0.012, z + Math.sin(a) * rad);
    // Lying down: rolled onto its side, pointing wherever it came to rest.
    euler.set(Math.PI / 2, 0, hash(i * 41 + 19) * Math.PI * 2);
    quat.setFromEuler(euler);
    scale.setScalar(1);
    brass.setMatrixAt(i, m.compose(pos, quat, scale));
  }
  group.add(brass);

  // ---- Field radio ----------------------------------------------------------------------------
  const radio = new THREE.Mesh(keep(new THREE.BoxGeometry(unit * 0.2, unit * 0.24, unit * 0.14)), gearMat);
  radio.position.set(x - width * 0.36, deckTopY + unit * 0.12, z - depth * 0.22);
  radio.rotation.y = 0.5;
  radio.castShadow = true;
  group.add(radio);
  const antenna = new THREE.Mesh(
    keep(new THREE.CylinderGeometry(unit * 0.006, unit * 0.006, unit * 0.9, 4)),
    gearMat,
  );
  antenna.position.set(radio.position.x, deckTopY + unit * 0.69, radio.position.z);
  antenna.rotation.z = 0.12;
  group.add(antenna);

  return {
    dispose(): void {
      group.removeFromParent();
      bags.dispose();
      brass.dispose();
      for (const o of owned) o.dispose();
    },
  };
}
