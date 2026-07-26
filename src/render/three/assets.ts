/**
 * Runtime loading of the build-time generated textures (docs/areas/11-art-visual-style.md §3.3).
 *
 * ## Progressive enhancement, without exception
 *
 * The world is fully playable before any of this resolves and stays fully playable if none of it
 * ever does. Materials are built with their palette colours as they always were; these textures
 * arrive later and are layered on top. Nothing here blocks a frame, nothing throws, and nothing is
 * logged — the boot smoke test asserts a clean console, and more importantly a player on a bad
 * connection should get a slightly plainer game, not an error.
 *
 * That is also why every failure path simply resolves `null`. There is no retry, no backoff and no
 * error surface: a texture that did not arrive is not a fault worth telling anyone about.
 *
 * ## Why this module owns the tiling, and not its callers
 *
 * Box UVs run 0..1 on every face whatever its size, so a texture's `repeat` has to be chosen per
 * surface or a two-metre roof deck and a thirty-metre tower shell show the same number of tiles.
 * Callers therefore say how big their surface *is*, in world units, and the tile density lives here
 * next to the textures it describes — one place to tune how coarse the world reads.
 *
 * Needs a GL context, so this sits outside the coverage gate. The generators it consumes are pure
 * and fully covered in `./texgen`.
 */

import * as THREE from 'three';

/** Keys of the manifest written by `scripts/gen-assets.mjs`. Must stay in step with its recipe. */
const TEXTURE_KEYS = ['concreteAlbedo', 'concreteNormal', 'concreteRoughness', 'windowEmissive'] as const;

type TextureKey = (typeof TEXTURE_KEYS)[number];

/** The manifest's `version`, mirrored here so a stale `public/gen` is ignored rather than misread. */
const EXPECTED_VERSION = 2;

/** World units covered by one repeat of the concrete maps. The single knob for aggregate scale. */
const CONCRETE_TILE = 2.4;

/** World units per window pane. A skyline storey is a few of these tall. */
const WINDOW_PITCH = 0.62;

/** The three maps that turn a flat-coloured surface into a material. */
export interface SurfaceTextures {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
}

export interface DetailTextures {
  /**
   * Concrete tiled to suit a surface `worldSize` units across. Results are cached per tile count,
   * and clones share one GPU upload, so asking repeatedly is free.
   */
  concreteFor(worldSize: number): SurfaceTextures;
  /**
   * The window mask, tiled to put roughly one pane per `WINDOW_PITCH` across a facade of the given
   * world size. `panes` shifts the lit/dark pattern by whole windows, which is what stops every
   * tower in the skyline lighting up identically — a fractional shift would misalign the frames.
   */
  windowsFor(worldWidth: number, worldHeight: number, panes: number): THREE.Texture;
  dispose(): void;
}

interface ManifestEntry {
  file: string;
}

interface Manifest {
  version: number;
  textures: Record<TextureKey, ManifestEntry>;
  /** Panes in one repeat of the window mask. The recipe owns it; the runtime must be told. */
  windowGrid: { columns: number; rows: number };
}

function isManifest(value: unknown): value is Manifest {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as { version?: unknown; textures?: unknown; windowGrid?: unknown };
  if (record.version !== EXPECTED_VERSION) return false;
  if (typeof record.textures !== 'object' || record.textures === null) return false;
  const grid = record.windowGrid as { columns?: unknown; rows?: unknown } | undefined;
  if (typeof grid?.columns !== 'number' || typeof grid.rows !== 'number') return false;
  if (grid.columns < 1 || grid.rows < 1) return false;
  const textures = record.textures as Record<string, { file?: unknown } | undefined>;
  return TEXTURE_KEYS.every((key) => typeof textures[key]?.file === 'string');
}

function loadTexture(loader: THREE.TextureLoader, url: string): Promise<THREE.Texture | null> {
  return new Promise((resolve) => {
    loader.load(
      url,
      (texture) => resolve(texture),
      undefined,
      () => resolve(null),
    );
  });
}

/**
 * Fetch the generated texture set. Resolves `null` if anything at all is missing or malformed.
 *
 * `basePath` is relative to the document, matching Vite's `base: './'` so the game works served
 * from a subpath (GitHub Pages) as readily as from a root.
 */
export async function loadDetailTextures(
  maxAnisotropy: number,
  basePath = 'gen/',
): Promise<DetailTextures | null> {
  let manifest: unknown;
  try {
    const response = await fetch(`${basePath}manifest.json`);
    if (!response.ok) return null;
    manifest = await response.json();
  } catch {
    return null; // offline, blocked, or the generator never ran — all equally uninteresting
  }
  if (!isManifest(manifest)) return null;
  const grid = manifest.windowGrid;

  const loader = new THREE.TextureLoader();
  const loaded = await Promise.all(
    TEXTURE_KEYS.map((key) => loadTexture(loader, `${basePath}${manifest.textures[key].file}`)),
  );
  if (loaded.some((texture) => texture === null)) {
    for (const texture of loaded) texture?.dispose();
    return null; // all or nothing: a half-textured world looks like a bug, not like a fallback
  }
  // One texture per key, all non-null by the check above. The tuple assertion is what tells the
  // compiler that; `noUncheckedIndexedAccess` cannot see the correspondence on its own.
  const textures = loaded as [THREE.Texture, THREE.Texture, THREE.Texture, THREE.Texture];
  const [albedo, normal, roughness, windows] = textures;

  const anisotropy = Math.max(1, maxAnisotropy);
  for (const texture of textures) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = anisotropy;
  }
  // Only the map that carries colour is sRGB. Normals, roughness and the window mask are data:
  // decoding them as colour would bend the normals and skew every other value toward gloss.
  albedo.colorSpace = THREE.SRGBColorSpace;

  const surfaceCache = new Map<number, SurfaceTextures>();
  const windowCache = new Map<string, THREE.Texture>();
  const clones: THREE.Texture[] = [];

  /** A clone shares its source image, so three uploads once — this costs a descriptor, not memory. */
  function derive(source: THREE.Texture): THREE.Texture {
    const clone = source.clone();
    clone.needsUpdate = true;
    clones.push(clone);
    return clone;
  }

  function concreteFor(worldSize: number): SurfaceTextures {
    const repeat = Math.max(1, Math.round(worldSize / CONCRETE_TILE));
    const cached = surfaceCache.get(repeat);
    if (cached) return cached;
    const set: SurfaceTextures = {
      map: derive(albedo),
      normalMap: derive(normal),
      roughnessMap: derive(roughness),
    };
    for (const texture of [set.map, set.normalMap, set.roughnessMap]) texture.repeat.set(repeat, repeat);
    surfaceCache.set(repeat, set);
    return set;
  }

  function windowsFor(worldWidth: number, worldHeight: number, panes: number): THREE.Texture {
    const x = Math.max(1, Math.round(worldWidth / (WINDOW_PITCH * grid.columns)));
    const y = Math.max(1, Math.round(worldHeight / (WINDOW_PITCH * grid.rows)));
    const key = `${x}:${y}:${panes}`;
    const cached = windowCache.get(key);
    if (cached) return cached;
    const texture = derive(windows);
    texture.repeat.set(x, y);
    // Offsets are in texture UV, so one pane is 1/grid — independent of the repeat above.
    texture.offset.set((panes % grid.columns) / grid.columns, (panes % grid.rows) / grid.rows);
    windowCache.set(key, texture);
    return texture;
  }

  return {
    concreteFor,
    windowsFor,
    dispose() {
      for (const texture of clones) texture.dispose();
      for (const texture of textures) texture.dispose();
      surfaceCache.clear();
      windowCache.clear();
      clones.length = 0;
    },
  };
}
