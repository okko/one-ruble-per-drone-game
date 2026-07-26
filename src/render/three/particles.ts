import * as THREE from 'three';
import { colorOf } from './theme';
import {
  EMBER,
  SMOKE,
  SPARK,
  advanceField,
  advanceRings,
  createField,
  createRings,
  emitBurst,
  emitRing,
  fadeOf,
  ringFade,
  ringRadius,
  type ParticleField,
  type RingField,
} from './vfx';

/**
 * Drawing for the particle simulation in ./vfx.
 *
 * The split is deliberate and it is the same one the rest of this renderer uses: the behaviour is
 * pure and proven by test, and this file is the thin, untestable layer that pushes it at a GPU. That
 * leaves almost nothing here to get wrong — three buffers and a compaction loop.
 *
 * Three draw calls for every explosion on screen at once: hot debris, smoke, and shockwave rings.
 * Everything is additive except the smoke, so overdraw is cheap and no sorting is needed; the fade
 * rides in the vertex colour, which is why a thousand particles can fade independently while sharing
 * one material.
 */

/** Sparks and embers together — the hot half of a burst. */
const HOT_CAPACITY = 420;
const SMOKE_CAPACITY = 180;
const RING_CAPACITY = 8;

/** Gravity the debris falls under. Not 9.8: a world unit here is about 3.3 m, and the arc is art. */
const GRAVITY = 7;

export interface VfxView {
  /** A drone died at this world point. `scale` is its radius in world units. */
  explode(x: number, y: number, z: number, scale: number): void;
  /** A round struck a tower: a small, sharp spray of concrete and sparks. */
  impact(x: number, y: number, z: number): void;
  /**
   * A drone got through and went off against a tower: dust up, rubble down, and no shockwave.
   *
   * The counterpart to `explode`, and it has to look nothing like it — see the body for why.
   */
  strike(x: number, y: number, z: number, scale: number): void;
  advance(dt: number): void;
  dispose(): void;
}

interface Cloud {
  points: THREE.Points;
  geometry: THREE.BufferGeometry;
  material: THREE.PointsMaterial;
  position: Float32Array;
  color: Float32Array;
}

/**
 * The soft round dot every particle is drawn with.
 *
 * A `PointsMaterial` with no map draws a hard square, and a sky full of hard white squares reads as
 * a rendering fault rather than as smoke. This is 32×32 of luminance falloff — 4 kB, built in a
 * dozen lines, no file, no loader — and it is the single change that turns the debris from blocks
 * into a puff. The falloff is squared so the edge is soft and the core still carries weight.
 */
function dotTexture(): THREE.DataTexture {
  const n = 32;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const dx = (x + 0.5) / n - 0.5;
      const dy = (y + 0.5) / n - 0.5;
      const d = Math.sqrt(dx * dx + dy * dy) * 2;
      const a = d >= 1 ? 0 : (1 - d) * (1 - d);
      const i = (y * n + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

function createCloud(
  capacity: number,
  size: number,
  blending: THREE.Blending,
  opacity: number,
  map: THREE.Texture,
): Cloud {
  const position = new Float32Array(capacity * 3);
  const color = new Float32Array(capacity * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(color, 3));
  geometry.setDrawRange(0, 0);
  // `boundingSphere` is computed once and left alone: the points move every frame and frustum
  // culling on a cloud that spans the sky would only ever be a per-frame recompute for no saving.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  const material = new THREE.PointsMaterial({
    size,
    map,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity,
    depthWrite: false,
    blending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return { points, geometry, material, position, color };
}

export function createVfx(scene: THREE.Scene): VfxView {
  const group = new THREE.Group();
  scene.add(group);

  const hotField: ParticleField = createField(HOT_CAPACITY);
  const smokeField: ParticleField = createField(SMOKE_CAPACITY);
  const rings: RingField = createRings(RING_CAPACITY);

  const dot = dotTexture();
  const hot = createCloud(HOT_CAPACITY, 0.44, THREE.AdditiveBlending, 1, dot);
  const smoke = createCloud(SMOKE_CAPACITY, 1.7, THREE.NormalBlending, 0.42, dot);
  group.add(smoke.points); // behind the sparks, so the hot debris always sits on top of its own smoke
  group.add(hot.points);

  // Shockwave rings. One flat annulus facing the camera's half of the world — the action all happens
  // in a single plane, so a billboard would spend a matrix per ring to reproduce a fixed rotation.
  const ringGeo = new THREE.RingGeometry(0.82, 1, 24);
  const ringMat = new THREE.MeshBasicMaterial({
    color: colorOf('explYellow'),
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const ringMesh = new THREE.InstancedMesh(ringGeo, ringMat, RING_CAPACITY);
  ringMesh.frustumCulled = false;
  ringMesh.count = 0;
  group.add(ringMesh);

  const sparkColor = colorOf('flashHot');
  const emberColor = colorOf('explOrange');
  const smokeColor = colorOf('smoke');
  /** What smoke fades INTO. Dissipating is losing contrast with the sky, not going dark. */
  const skyColor = colorOf('skyDayLow');
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();

  /**
   * Compact the live slots of `field` into `cloud`'s buffers, returning how many were written.
   *
   * The fade rides entirely in the vertex colour, which is what lets a thousand particles fade
   * independently while sharing one material. For the additive clouds that is literally correct —
   * multiplying an additive colour IS reducing it — and it buys the cooling for free: a spark loses
   * its blue first, then its green, so it goes white → yellow → orange on the way out rather than
   * merely dimming. Smoke is not additive, so it cannot be faded by darkening; it is lerped toward
   * the sky instead, which is what dissipating actually looks like.
   */
  function fill(field: ParticleField, cloud: Cloud): number {
    let n = 0;
    for (let i = 0; i < field.capacity; i += 1) {
      if (field.alive[i] !== 1) continue;
      const fade = fadeOf(field, i);
      cloud.position[n * 3] = field.x[i] ?? 0;
      cloud.position[n * 3 + 1] = field.y[i] ?? 0;
      cloud.position[n * 3 + 2] = field.z[i] ?? 0;
      const kind = field.kind[i];
      if (kind === SMOKE) {
        cloud.color[n * 3] = smokeColor.r + (skyColor.r - smokeColor.r) * (1 - fade);
        cloud.color[n * 3 + 1] = smokeColor.g + (skyColor.g - smokeColor.g) * (1 - fade);
        cloud.color[n * 3 + 2] = smokeColor.b + (skyColor.b - smokeColor.b) * (1 - fade);
      } else {
        const base = kind === SPARK ? sparkColor : emberColor;
        cloud.color[n * 3] = base.r * fade;
        cloud.color[n * 3 + 1] = base.g * fade * fade;
        cloud.color[n * 3 + 2] = base.b * fade * fade * fade;
      }
      n += 1;
    }
    cloud.geometry.setDrawRange(0, n);
    if (n > 0) {
      cloud.geometry.getAttribute('position').needsUpdate = true;
      cloud.geometry.getAttribute('color').needsUpdate = true;
    }
    return n;
  }

  return {
    explode(x: number, y: number, z: number, scale: number): void {
      const size = Math.max(0.5, scale);
      emitBurst(hotField, { x, y, z, count: 14, kind: SPARK, speed: 9 * size, life: 0.32, size: 1, rise: 0.2 });
      emitBurst(hotField, { x, y, z, count: 10, kind: EMBER, speed: 5 * size, life: 0.7, size: 1, rise: 0.1 });
      emitBurst(smokeField, { x, y, z, count: 7, kind: SMOKE, speed: 1.6 * size, life: 1.1, size: 1, rise: 0.5 });
      emitRing(rings, x, y, z, 1.9 * size, 0.2);
    },
    impact(x: number, y: number, z: number): void {
      emitBurst(hotField, { x, y, z, count: 5, kind: SPARK, speed: 5, life: 0.18, size: 1, rise: 0.4 });
      emitBurst(smokeField, { x, y, z, count: 2, kind: SMOKE, speed: 0.8, life: 0.6, size: 1, rise: 0.6 });
    },
    strike(x: number, y: number, z: number, scale: number): void {
      const size = Math.max(0.5, scale);
      // Deliberately NOT an explosion. A kill and a hit-taken are the two outcomes of the same event
      // — a drone stops existing — and if they look alike the player cannot tell a good shift from a
      // bad one. So this is built out of the opposite half of the vocabulary: a slow grey dust column
      // instead of a fast additive flash, debris FALLING instead of a shockwave expanding, and no
      // ring at all. The ring is the signature of a clean airburst and it is reserved for one.
      emitBurst(smokeField, { x, y, z, count: 18, kind: SMOKE, speed: 2.6 * size, life: 1.9, size: 1.5, rise: 0.6 });
      // Negative rise. `emitBurst` biases the vertical spread by it, so this throws burning rubble
      // DOWN the face of the building it just came off, which is the read: something hit the tower,
      // and the tower is shedding.
      emitBurst(hotField, { x, y, z, count: 10, kind: EMBER, speed: 3.4 * size, life: 1.2, size: 1.1, rise: -0.5 });
      emitBurst(hotField, { x, y, z, count: 6, kind: SPARK, speed: 4 * size, life: 0.24, size: 0.9, rise: -0.2 });
    },
    advance(dt: number): void {
      advanceField(hotField, dt, GRAVITY);
      advanceField(smokeField, dt, GRAVITY);
      advanceRings(rings, dt);

      fill(hotField, hot);
      fill(smokeField, smoke);

      let n = 0;
      for (let i = 0; i < rings.capacity; i += 1) {
        const fade = ringFade(rings, i);
        if (fade <= 0) continue;
        p.set(rings.x[i] ?? 0, rings.y[i] ?? 0, rings.z[i] ?? 0);
        s.setScalar(ringRadius(rings, i));
        ringMesh.setMatrixAt(n, m.compose(p, q, s));
        // Instance colour is the only per-ring channel an additive shared material has, so the fade
        // rides there — the same trick the particles use, for the same reason. `setColorAt` is what
        // allocates `instanceColor` in the first place, so it has to come before the fade is written.
        ringMesh.setColorAt(n, sparkColor);
        ringMesh.instanceColor?.setXYZ(
          n,
          sparkColor.r * fade,
          sparkColor.g * fade,
          sparkColor.b * fade * 0.6,
        );
        n += 1;
      }
      ringMesh.count = n;
      if (n > 0) {
        ringMesh.instanceMatrix.needsUpdate = true;
        if (ringMesh.instanceColor) ringMesh.instanceColor.needsUpdate = true;
      }
    },
    dispose(): void {
      group.removeFromParent();
      hot.geometry.dispose();
      hot.material.dispose();
      smoke.geometry.dispose();
      smoke.material.dispose();
      dot.dispose();
      ringMesh.dispose();
      ringGeo.dispose();
      ringMat.dispose();
    },
  };
}
