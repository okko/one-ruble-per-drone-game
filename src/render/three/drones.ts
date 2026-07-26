import * as THREE from 'three';
import { colorOf, type WorldColorKey } from './theme';

/**
 * Drone bodies.
 *
 * Every drone in the game used to be the same icosahedron in a different colour. Colour alone is the
 * weakest signal a game has: it is the first thing lost to a bright sky, to a colour-blind player and
 * to the two-hundred-millisecond glance a player actually gets before deciding whether to shoot. What
 * each kind DOES is different, so what each kind LOOKS like should be too — a silhouette that reads
 * at a glance and survives being small, backlit and moving.
 *
 * So: the scout is a thin quadcopter, the heavy a squat armoured hexacopter, the kamikaze a delta
 * wing with no rotors at all, the frenzy a tiny swarm body, the decoy a bird, and the boss a broad
 * multi-rotor with a lit core.
 *
 * Each kind is ONE geometry, merged here at construction from primitives, so a drone is still one
 * draw call however many pieces it appears to have. Rotor discs are a single instanced mesh shared
 * across every drone on screen, because they are all the same disc at different places — the whole
 * flight adds one call, not one per rotor.
 */

/** Rotors any one drone can show. Sized for the boss; smaller kinds simply use fewer. */
const MAX_ROTORS_PER_DRONE = 8;

/**
 * Merge geometries into one.
 *
 * three's own `mergeGeometries` lives in the addons, and this renderer has spent this whole rework
 * declining to pull addon trees in for small jobs (the Kremlin star cost twelve kilobytes gzipped
 * before it was hand-built). De-indexing first means there is only ever one case to handle:
 * concatenate the attributes and be done.
 */
function merge(parts: readonly { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 }[]): THREE.BufferGeometry {
  const flats: THREE.BufferGeometry[] = [];
  let vertices = 0;
  for (const part of parts) {
    const flat = (part.geometry.index ? part.geometry.toNonIndexed() : part.geometry.clone());
    flat.applyMatrix4(part.matrix);
    flats.push(flat);
    vertices += flat.getAttribute('position').count;
  }
  const position = new Float32Array(vertices * 3);
  const normal = new Float32Array(vertices * 3);
  let at = 0;
  for (const flat of flats) {
    const p = flat.getAttribute('position');
    const n = flat.getAttribute('normal');
    position.set(p.array as Float32Array, at * 3);
    normal.set(n.array as Float32Array, at * 3);
    at += p.count;
    flat.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(position, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  return out;
}

interface Part {
  geometry: THREE.BufferGeometry;
  matrix: THREE.Matrix4;
}

function at(geometry: THREE.BufferGeometry, x: number, y: number, z: number, rot?: THREE.Euler): Part {
  const matrix = new THREE.Matrix4();
  if (rot) matrix.makeRotationFromEuler(rot);
  matrix.setPosition(x, y, z);
  return { geometry, matrix };
}

/** Where a kind's rotors sit, in body units (the body geometry is built at unit radius). */
export interface DroneShape {
  geometry: THREE.BufferGeometry;
  rotors: readonly { x: number; y: number; z: number; r: number }[];
  color: WorldColorKey;
}

function quadArms(reach: number, thickness: number, parts: Part[]): void {
  const arm = new THREE.BoxGeometry(reach * 2, thickness, thickness);
  for (const yaw of [Math.PI / 4, -Math.PI / 4]) {
    parts.push(at(arm, 0, 0, 0, new THREE.Euler(0, yaw, 0)));
  }
}

function buildShape(kind: string): DroneShape {
  const parts: Part[] = [];
  switch (kind) {
    case 'heavy': {
      // Squat, armoured, six rotors. Reads as heavy because it is WIDE and low, not because it is big.
      parts.push(at(new THREE.CylinderGeometry(0.55, 0.7, 0.34, 6), 0, 0, 0));
      parts.push(at(new THREE.CylinderGeometry(0.36, 0.36, 0.16, 6), 0, 0.24, 0));
      const arm = new THREE.BoxGeometry(1.9, 0.09, 0.09);
      for (let i = 0; i < 3; i += 1) {
        parts.push(at(arm, 0, 0, 0, new THREE.Euler(0, (i * Math.PI) / 3, 0)));
      }
      const rotors: DroneShape['rotors'] = Array.from({ length: 6 }, (_, i) => {
        const a = (i * Math.PI) / 3;
        return { x: Math.cos(a) * 0.95, y: 0.1, z: Math.sin(a) * 0.95, r: 0.42 };
      });
      return { geometry: merge(parts), rotors, color: 'droneBomber' };
    }
    case 'kamikaze': {
      // A delta wing and a warhead. No rotors: nothing about it says "hovering", everything says
      // "committed", which is exactly what it is about to do.
      const wing = new THREE.ConeGeometry(0.75, 1.6, 3);
      parts.push(at(wing, 0, 0, 0, new THREE.Euler(Math.PI / 2, 0, 0)));
      parts.push(at(new THREE.SphereGeometry(0.3, 6, 5), 0, 0, 0.7));
      parts.push(at(new THREE.BoxGeometry(0.08, 0.5, 0.4), 0, 0.28, -0.55));
      return { geometry: merge(parts), rotors: [], color: 'droneBoss' };
    }
    case 'frenzy': {
      // Small, cheap, and there are a lot of them. One rotor and a stub body.
      parts.push(at(new THREE.OctahedronGeometry(0.45, 0), 0, 0, 0));
      quadArms(0.5, 0.07, parts);
      return {
        geometry: merge(parts),
        rotors: [
          { x: 0.36, y: 0.08, z: 0.36, r: 0.26 },
          { x: -0.36, y: 0.08, z: -0.36, r: 0.26 },
        ],
        color: 'droneSwarm',
      };
    }
    case 'decoy_bird': {
      // Not a machine at all. If the player shoots it they have wasted heat, so it had better be
      // obvious from a long way off that it is alive rather than built.
      parts.push(at(new THREE.SphereGeometry(0.32, 6, 5), 0, 0, 0));
      parts.push(at(new THREE.ConeGeometry(0.14, 0.4, 4), 0, 0, 0.34, new THREE.Euler(Math.PI / 2, 0, 0)));
      const wing = new THREE.BoxGeometry(1.5, 0.05, 0.5);
      parts.push(at(wing, 0, 0.1, -0.05, new THREE.Euler(0, 0, 0.22)));
      parts.push(at(new THREE.ConeGeometry(0.18, 0.5, 3), 0, 0.02, -0.5, new THREE.Euler(-Math.PI / 2, 0, 0)));
      return { geometry: merge(parts), rotors: [], color: 'cream' };
    }
    case 'boss': {
      // Broad, deliberate, with a lit core. The only drone that gets an emissive part, so the one
      // thing on screen that glows from inside is unambiguous.
      parts.push(at(new THREE.CylinderGeometry(0.8, 0.95, 0.4, 8), 0, 0, 0));
      parts.push(at(new THREE.IcosahedronGeometry(0.42, 0), 0, 0.3, 0));
      const arm = new THREE.BoxGeometry(2.9, 0.12, 0.12);
      for (let i = 0; i < 4; i += 1) {
        parts.push(at(arm, 0, 0, 0, new THREE.Euler(0, (i * Math.PI) / 4, 0)));
      }
      const rotors: DroneShape['rotors'] = Array.from({ length: 8 }, (_, i) => {
        const a = (i * Math.PI) / 4;
        return { x: Math.cos(a) * 1.45, y: 0.12, z: Math.sin(a) * 1.45, r: 0.5 };
      });
      return { geometry: merge(parts), rotors, color: 'droneBoss' };
    }
    default: {
      // Scout: a thin, ordinary quadcopter. The baseline every other silhouette is read against.
      parts.push(at(new THREE.BoxGeometry(0.5, 0.22, 0.8), 0, 0, 0));
      parts.push(at(new THREE.SphereGeometry(0.16, 6, 5), 0, -0.08, 0.28));
      quadArms(0.85, 0.08, parts);
      const rotors: DroneShape['rotors'] = [
        { x: 0.6, y: 0.08, z: 0.6, r: 0.34 },
        { x: -0.6, y: 0.08, z: 0.6, r: 0.34 },
        { x: 0.6, y: 0.08, z: -0.6, r: 0.34 },
        { x: -0.6, y: 0.08, z: -0.6, r: 0.34 },
      ];
      return { geometry: merge(parts), rotors, color: 'droneScout' };
    }
  }
}

export interface DroneSighting {
  kind: string;
  x: number;
  y: number;
  z: number;
  radius: number;
  /** Overrides the kind's colour when the sim has tagged this drone (the bounty markers). */
  colorTag: boolean;
}

export interface DroneFlight {
  /** Draw the drones currently alive. Anything not in the list is hidden, not destroyed. */
  update(seen: readonly DroneSighting[], time: number): void;
  dispose(): void;
}

export function createDrones(scene: THREE.Scene, capacity: number): DroneFlight {
  const group = new THREE.Group();
  scene.add(group);

  const shapes = new Map<string, DroneShape>();
  function shapeFor(kind: string): DroneShape {
    let shape = shapes.get(kind);
    if (!shape) {
      shape = buildShape(kind);
      shapes.set(kind, shape);
    }
    return shape;
  }
  // Every kind is built up front. Building one mid-flight would be an allocation in the render loop,
  // and the first heavy of the run would arrive with a hitch (§7).
  for (const kind of ['scout', 'heavy', 'kamikaze', 'frenzy', 'decoy_bird', 'boss']) shapeFor(kind);

  /** One rotor disc, instanced across every drone on screen. Additive, so it reads as blur. */
  const rotorGeo = new THREE.CircleGeometry(1, 12);
  rotorGeo.rotateX(-Math.PI / 2);
  const rotorMat = new THREE.MeshBasicMaterial({
    color: colorOf('cloud'),
    transparent: true,
    opacity: 0.28,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const rotors = new THREE.InstancedMesh(rotorGeo, rotorMat, capacity * MAX_ROTORS_PER_DRONE);
  rotors.frustumCulled = false;
  rotors.count = 0;
  group.add(rotors);

  const bodies: THREE.Mesh[] = [];
  const bodyMats: THREE.MeshStandardMaterial[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const euler = new THREE.Euler();

  return {
    update(seen: readonly DroneSighting[], time: number): void {
      let rotorAt = 0;
      for (let i = 0; i < seen.length; i += 1) {
        const d = seen[i];
        if (!d) continue; // unreachable: `i` is bounded by the array's own length
        const shape = shapeFor(d.kind);
        let body = bodies[i];
        if (!body) {
          const material = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.6 });
          body = new THREE.Mesh(shape.geometry, material);
          bodies.push(body);
          bodyMats.push(material);
          group.add(body);
        }
        body.visible = true;
        if (body.geometry !== shape.geometry) body.geometry = shape.geometry;
        const scale = Math.max(0.5, d.radius / 5);
        body.position.set(d.x, d.y, d.z);
        body.scale.setScalar(scale);
        // A slow, tilted drift rather than the old tumble: a quadcopter that cartwheels is a rock.
        // Yaw comes from the id-free time so the whole flight does not turn in lockstep.
        body.rotation.set(Math.sin(time * 1.3 + i) * 0.14, time * 0.6 + i * 1.7, Math.cos(time * 1.1 + i) * 0.12);
        const mat = bodyMats[i];
        if (mat) mat.color.copy(colorOf(d.colorTag ? 'accentPink' : shape.color));

        for (const r of shape.rotors) {
          if (rotorAt >= rotors.instanceMatrix.count) break;
          pos.set(r.x * scale, r.y * scale, r.z * scale).applyEuler(body.rotation).add(body.position);
          euler.set(body.rotation.x, time * 40 + rotorAt, body.rotation.z);
          q.setFromEuler(euler);
          scl.setScalar(r.r * scale);
          rotors.setMatrixAt(rotorAt, m.compose(pos, q, scl));
          rotorAt += 1;
        }
      }
      for (let i = seen.length; i < bodies.length; i += 1) {
        const body = bodies[i];
        if (body) body.visible = false;
      }
      // Truncating rather than hiding: `count` is the whole cost of an unused rotor.
      rotors.count = rotorAt;
      if (rotorAt > 0) rotors.instanceMatrix.needsUpdate = true;
    },
    dispose(): void {
      group.removeFromParent();
      rotors.dispose();
      rotorGeo.dispose();
      rotorMat.dispose();
      for (const mat of bodyMats) mat.dispose();
      for (const shape of shapes.values()) shape.geometry.dispose();
    },
  };
}
