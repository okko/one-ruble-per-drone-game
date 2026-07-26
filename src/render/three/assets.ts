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
 * Needs a GL context, so this sits outside the coverage gate. The generators it consumes are pure
 * and fully covered in `./texgen`.
 */

import * as THREE from 'three';

/** Keys of the manifest written by `scripts/gen-assets.mjs`. Must stay in step with its recipe. */
const TEXTURE_KEYS = ['concreteAlbedo', 'concreteNormal', 'concreteRoughness'] as const;

type TextureKey = (typeof TEXTURE_KEYS)[number];

/** The manifest's `version`, mirrored here so a stale `public/gen` is ignored rather than misread. */
const EXPECTED_VERSION = 1;

/** The three maps that turn a flat-coloured surface into a material. */
export interface SurfaceTextures {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
}

export interface DetailTextures {
  /**
   * Concrete tiled `repeat` times across each UV unit.
   *
   * Repeat has to vary per surface: box UVs run 0..1 on every face regardless of its size, so a
   * single shared setting would make the two-metre roof deck and the thirty-metre tower shell show
   * the same number of tiles, and the deck's aggregate would read ten times too coarse. Results are
   * cached per repeat, and clones share one GPU upload, so asking repeatedly is free.
   */
  concrete(repeat: number): SurfaceTextures;
  dispose(): void;
}

interface ManifestEntry {
  file: string;
}

function isManifest(value: unknown): value is { version: number; textures: Record<TextureKey, ManifestEntry> } {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as { version?: unknown; textures?: unknown };
  if (record.version !== EXPECTED_VERSION) return false;
  if (typeof record.textures !== 'object' || record.textures === null) return false;
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
  const textures = loaded as [THREE.Texture, THREE.Texture, THREE.Texture];
  const [albedo, normal, roughness] = textures;

  const anisotropy = Math.max(1, maxAnisotropy);
  for (const texture of textures) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = anisotropy;
  }
  // Only the map that carries colour is sRGB. Normals and roughness are data: decoding them as
  // colour would bend the normals and skew every roughness value toward gloss.
  albedo.colorSpace = THREE.SRGBColorSpace;

  const cache = new Map<number, SurfaceTextures>();
  const clones: THREE.Texture[] = [];

  function concrete(repeat: number): SurfaceTextures {
    const cached = cache.get(repeat);
    if (cached) return cached;
    const set: SurfaceTextures = {
      map: albedo.clone(),
      normalMap: normal.clone(),
      roughnessMap: roughness.clone(),
    };
    for (const texture of [set.map, set.normalMap, set.roughnessMap]) {
      texture.repeat.set(repeat, repeat);
      // A clone shares its source image but not its transform, and three only uploads once per
      // source — so this costs a descriptor, not a texture.
      texture.needsUpdate = true;
      clones.push(texture);
    }
    cache.set(repeat, set);
    return set;
  }

  return {
    concrete,
    dispose() {
      for (const texture of clones) texture.dispose();
      for (const texture of textures) texture.dispose();
      cache.clear();
      clones.length = 0;
    },
  };
}
