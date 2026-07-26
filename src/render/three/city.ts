/**
 * The Moscow skyline (docs/areas/11-art-visual-style.md §3.1, §3.3).
 *
 * `./city-layout` decides what each tower looks like; this turns that into geometry. It needs a GL
 * context, so it sits outside the coverage gate — everything decidable without one was pushed into
 * the layout module, which is fully covered and mutation-tested.
 *
 * ## Two ways of switching a box off, and why there are two
 *
 * Damage removes storeys from the top, so the storey masses of one building are a single
 * `InstancedMesh` whose `count` is the number still standing. That is the cheapest possible
 * representation of "this tower has lost four floors": one integer, no matrix writes, no allocation
 * — and it is exact, because `./city-layout` guarantees the instances are ordered bottom to top.
 *
 * Everything else — cornices, crowns, roof furniture — is scattered across all eight towers, so
 * truncation cannot express it. Those share one instanced mesh per *kind* across the whole skyline
 * and are switched off individually by collapsing an instance to zero scale. That costs a matrix
 * write, which is why it only happens on the frames where a tower's height actually changes.
 *
 * The result is a skyline in roughly fourteen draw calls instead of the three hundred and
 * twenty-four it used to take (docs/compatibility.md §7).
 */

import * as THREE from 'three';

import { boxesAlive, cityLayoutFor, clutterOffset, type CityBox, type CityLayout } from './city-layout';
import { AS, ax, ay, GROUND_Y, SKYLINE_Z } from './mapping';
import { colorOf, type WorldColorKey } from './theme';
import type { DetailTextures } from './assets';

/** The subset of a skyline building this module needs. Matches both the content table and the state. */
export interface CityBuilding {
  id: number;
  x: number;
  width: number;
  height: number;
  stories: number;
}

/** How much of a tower is standing, as the renderer sees it. `cut` is a float; the renderer floors it. */
export interface CityDamage {
  id: number;
  cut: number;
}

export interface CityView {
  /** Hand over the generated maps once (and if) they arrive. Safe to never call. */
  applyDetail(textures: DetailTextures): void;
  /** Per frame: apply damage and the night-time window glow. */
  update(buildings: readonly CityDamage[], windowGlow: number): void;
  dispose(): void;
}

/** Instances that are switched on and off individually rather than truncated. See the header. */
interface Zone {
  mesh: THREE.InstancedMesh;
  /** Per instance: the transform it has while it stands. */
  live: THREE.Matrix4[];
  /** Per instance: the storey it dies with, in its owner's numbering. */
  storey: number[];
  /** Building index → the half-open instance range it owns. */
  range: Map<number, [number, number]>;
  dirty: boolean;
}

interface ZoneEntry {
  owner: number;
  storey: number;
  matrix: THREE.Matrix4;
  color?: THREE.Color;
}

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

/** Onion profile, normalised to a unit radius and a unit height, drawn base-first. */
const DOME_PROFILE: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.58, 0],
  [0.8, 0.09],
  [0.96, 0.24],
  [1, 0.4],
  [0.86, 0.57],
  [0.58, 0.72],
  [0.3, 0.84],
  [0.12, 0.93],
  [0, 1],
];

function domeGeometry(): THREE.BufferGeometry {
  return new THREE.LatheGeometry(
    DOME_PROFILE.map(([r, y]) => new THREE.Vector2(r, y)),
    14,
  );
}

/**
 * A five-pointed star as a triangle fan, facing the camera.
 *
 * Worth the twenty lines: it is the one silhouette that says which city this is, and at this
 * distance nothing else on the roofline carries that. Built by hand rather than with
 * `ExtrudeGeometry` because that pulls three's whole shape/curve/triangulation stack into the
 * bundle — twelve kilobytes gzipped, measured, for eleven vertices we can simply write down.
 * Double-sided and flat: the skyline is only ever seen from one side, and the star is emissive, so
 * there is no shading for a thickness to give it.
 */
function starGeometry(): THREE.BufferGeometry {
  const points = 5;
  const rim = points * 2;
  const position = new Float32Array((rim + 1) * 3);
  for (let i = 0; i < rim; i += 1) {
    const radius = i % 2 === 0 ? 1 : 0.42;
    const angle = (i / rim) * Math.PI * 2 + Math.PI / 2;
    position[i * 3] = Math.cos(angle) * radius;
    position[i * 3 + 1] = Math.sin(angle) * radius;
  }
  // The last vertex is the centre; every triangle fans from it.
  const index: number[] = [];
  for (let i = 0; i < rim; i += 1) index.push(rim, i, (i + 1) % rim);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

/** Cone with its base on y = 0, so a crown can be placed by its footing rather than its middle. */
function spireGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.ConeGeometry(1, 1, 6);
  geometry.translate(0, 0.5, 0);
  return geometry;
}

function boxMatrix(box: CityBox, x: number, base: number, z: number): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, base + box.y, z),
    new THREE.Quaternion(),
    new THREE.Vector3(box.width, box.height, box.depth),
  );
}

function buildZone(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  entries: readonly ZoneEntry[],
): Zone {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, entries.length));
  mesh.count = entries.length;
  // The skyline fills the frame whenever it is on screen at all, and these are a handful of draw
  // calls; recomputing bounds every time a tower loses a floor would cost more than it saved.
  mesh.frustumCulled = false;
  const zone: Zone = { mesh, live: [], storey: [], range: new Map(), dirty: false };
  entries.forEach((entry, i) => {
    mesh.setMatrixAt(i, entry.matrix);
    if (entry.color) mesh.setColorAt(i, entry.color);
    zone.live.push(entry.matrix);
    zone.storey.push(entry.storey);
    const seen = zone.range.get(entry.owner);
    if (seen) seen[1] = i + 1;
    else zone.range.set(entry.owner, [i, i + 1]);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  parent.add(mesh);
  return zone;
}

function refreshZone(zone: Zone, owner: number, surviving: number): void {
  const range = zone.range.get(owner);
  if (!range) return;
  for (let i = range[0]; i < range[1]; i += 1) {
    zone.mesh.setMatrixAt(i, (zone.storey[i] as number) < surviving ? (zone.live[i] as THREE.Matrix4) : HIDDEN);
  }
  zone.dirty = true;
}

/**
 * Build the skyline into `scene`.
 *
 * Heights come through `ay`, exactly as they did when this was a stack of loose slabs, so a tower's
 * roof still lands on the world y a drone dives at. That correspondence is the whole reason the
 * skyline is where it is; it is not a look.
 */
export function createCity(
  scene: THREE.Scene,
  skyline: { groundY: number; buildings: readonly CityBuilding[] },
): CityView {
  const group = new THREE.Group();
  scene.add(group);

  // One box geometry for every rectangular thing in the skyline. Instance transforms carry the
  // size, so eight towers, their cornices, their roof furniture and the horizon share one upload.
  const unitBox = new THREE.BoxGeometry(1, 1, 1);

  const layouts: CityLayout[] = [];
  const indexById = new Map<number, number>();
  const facades: THREE.InstancedMesh[] = [];
  const facadeMats: THREE.MeshStandardMaterial[] = [];
  const surviving: number[] = [];
  /** False until the generated window mask lands; see the fallback in `update`. */
  let windowed = false;

  const trim: ZoneEntry[] = [];
  const domes: ZoneEntry[] = [];
  const spires: ZoneEntry[] = [];
  const stars: ZoneEntry[] = [];
  const boxes: ZoneEntry[] = [];

  const domeKeys: readonly WorldColorKey[] = ['domeGold', 'domeTeal', 'domeRed'];

  skyline.buildings.forEach((b, index) => {
    const roofY = ay(skyline.groundY - b.height);
    const layout = cityLayoutFor(b.id, b.width * AS, roofY - GROUND_Y, b.stories);
    layouts.push(layout);
    indexById.set(b.id, index);
    surviving.push(layout.storeys);

    const x = ax(b.x);
    // Alternating body tones, as before. Two colours over eight towers is enough to separate them
    // without turning a skyline into a colour chart.
    const material = new THREE.MeshStandardMaterial({
      color: colorOf(b.id % 2 === 0 ? 'concrete' : 'concreteDk'),
      emissive: colorOf('windowLit'),
      emissiveIntensity: 0,
      roughness: 0.92,
    });
    facadeMats.push(material);

    const facade = new THREE.InstancedMesh(unitBox, material, layout.bands.length);
    facade.frustumCulled = false;
    layout.bands.forEach((band, i) => facade.setMatrixAt(i, boxMatrix(band, x, GROUND_Y, SKYLINE_Z)));
    facade.instanceMatrix.needsUpdate = true;
    group.add(facade);
    facades.push(facade);

    for (const cornice of layout.cornices) {
      trim.push({ owner: index, storey: cornice.storey, matrix: boxMatrix(cornice, x, GROUND_Y, SKYLINE_Z) });
    }

    const crown = layout.crown;
    const crownY = GROUND_Y + crown.base;
    const topStorey = layout.storeys - 1;
    const footing = new THREE.Vector3(x, crownY, SKYLINE_Z);
    if (crown.kind === 'dome') {
      domes.push({
        owner: index,
        storey: topStorey,
        matrix: new THREE.Matrix4().compose(
          footing,
          new THREE.Quaternion(),
          new THREE.Vector3(crown.radius, crown.height, crown.radius),
        ),
        color: colorOf(domeKeys[crown.hue] ?? 'domeGold'),
      });
    } else if (crown.kind === 'spire') {
      spires.push({
        owner: index,
        storey: topStorey,
        matrix: new THREE.Matrix4().compose(
          footing,
          new THREE.Quaternion(),
          new THREE.Vector3(crown.radius * 0.5, crown.height, crown.radius * 0.5),
        ),
      });
      // A star only ever tops a spire — that is what a spire is for.
      stars.push({
        owner: index,
        storey: topStorey,
        matrix: new THREE.Matrix4().compose(
          new THREE.Vector3(x, crownY + crown.height + crown.radius * 0.34, SKYLINE_Z),
          new THREE.Quaternion(),
          new THREE.Vector3(crown.radius * 0.38, crown.radius * 0.38, crown.radius * 0.38),
        ),
      });
    } else {
      boxes.push({
        owner: index,
        storey: topStorey,
        matrix: new THREE.Matrix4().compose(
          new THREE.Vector3(x, crownY + crown.height / 2, SKYLINE_Z),
          new THREE.Quaternion(),
          new THREE.Vector3(crown.radius * 1.5, crown.height, crown.radius * 1.5),
        ),
      });
    }

    crown.clutter.forEach((piece, i) => {
      const offset = clutterOffset(b.id, i, crown.clutter.length);
      boxes.push({
        owner: index,
        storey: piece.storey,
        matrix: boxMatrix(piece, x + offset * layout.width, GROUND_Y, SKYLINE_Z),
      });
    });
  });

  // Cornices are trim, so they are the lighter of the two body tones whichever tower they cap.
  const trimMat = new THREE.MeshStandardMaterial({ color: colorOf('concrete'), roughness: 0.9 });
  // White, because the per-instance colour carries the actual dome hue and the two multiply.
  const domeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.6, roughness: 0.3 });
  const spireMat = new THREE.MeshStandardMaterial({ color: colorOf('gunmetal'), metalness: 0.7, roughness: 0.35 });
  const starMat = new THREE.MeshStandardMaterial({
    color: colorOf('domeRed'),
    emissive: colorOf('domeRed'),
    emissiveIntensity: 0.85,
    metalness: 0.4,
    roughness: 0.4,
    side: THREE.DoubleSide,
  });
  const boxMat = new THREE.MeshStandardMaterial({ color: colorOf('gunmetalDk'), roughness: 0.75 });

  const zones: Zone[] = [
    buildZone(group, unitBox, trimMat, trim),
    buildZone(group, domeGeometry(), domeMat, domes),
    buildZone(group, spireGeometry(), spireMat, spires),
    buildZone(group, starGeometry(), starMat, stars),
    buildZone(group, unitBox, boxMat, boxes),
  ];

  // ---- The horizon ---------------------------------------------------------------------------
  // Behind the skyline the ground plane used to meet the sky in a hard dark line, which was the one
  // thing that gave away that the city was eight towers on an empty field. A low, dim outer ward
  // sits between them and the fog, so the eye reads distance instead of an edge.
  const WARD_COUNT = 48;
  const wardMat = new THREE.MeshStandardMaterial({ color: colorOf('concreteDk'), roughness: 1 });
  const ward = new THREE.InstancedMesh(unitBox, wardMat, WARD_COUNT);
  ward.frustumCulled = false;
  for (let i = 0; i < WARD_COUNT; i += 1) {
    // Deterministic, not random: the horizon is scenery the player learns the shape of.
    const t = (i + 0.5) / WARD_COUNT;
    const jitter = Math.sin(i * 12.9898) * 0.5 + 0.5;
    const w = 2.4 + jitter * 2.6;
    const h = 5 + jitter * 11;
    ward.setMatrixAt(
      i,
      new THREE.Matrix4().compose(
        new THREE.Vector3((t - 0.5) * 190, GROUND_Y + h / 2, SKYLINE_Z - 16 - jitter * 14),
        new THREE.Quaternion(),
        new THREE.Vector3(w, h, w * 0.8),
      ),
    );
  }
  ward.instanceMatrix.needsUpdate = true;
  group.add(ward);

  return {
    applyDetail(textures: DetailTextures): void {
      layouts.forEach((layout, index) => {
        const material = facadeMats[index];
        if (!material) return;
        const set = textures.concreteFor(layout.width);
        material.map = set.map;
        material.normalMap = set.normalMap;
        material.roughnessMap = set.roughnessMap;
        // Windows are sized against a single storey band, because that is what the instance is.
        material.emissiveMap = textures.windowsFor(layout.width, layout.storeyHeight, layout.id);
        material.needsUpdate = true;
      });
      const set = textures.concreteFor(4);
      trimMat.map = set.map;
      trimMat.normalMap = set.normalMap;
      trimMat.roughnessMap = set.roughnessMap;
      trimMat.needsUpdate = true;
      wardMat.map = set.map;
      wardMat.needsUpdate = true;
      windowed = true;
    },

    update(buildings: readonly CityDamage[], windowGlow: number): void {
      for (const b of buildings) {
        const index = indexById.get(b.id);
        if (index === undefined) continue;
        const layout = layouts[index];
        const facade = facades[index];
        if (!layout || !facade) continue;
        const standing = Math.max(0, layout.storeys - Math.floor(b.cut));
        if (standing !== surviving[index]) {
          surviving[index] = standing;
          facade.count = boxesAlive(layout.bands, standing);
          for (const zone of zones) refreshZone(zone, index, standing);
        }
        const material = facadeMats[index];
        // Only the emissive strength moves with the day; the map itself never changes. Without the
        // generated mask there are no panes to light, so the whole facade glows faintly instead —
        // far weaker, but night still has to read as lit-from-within rather than as a silhouette.
        if (material) material.emissiveIntensity = windowGlow * (windowed ? 1 : 0.16);
      }
      for (const zone of zones) {
        if (!zone.dirty) continue;
        zone.mesh.instanceMatrix.needsUpdate = true;
        zone.dirty = false;
      }
    },

    dispose(): void {
      scene.remove(group);
      group.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        if (o instanceof THREE.InstancedMesh) o.dispose(); // releases the per-instance buffers
        o.geometry.dispose();
        const material = o.material;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material.dispose();
      });
    },
  };
}
