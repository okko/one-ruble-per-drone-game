// Build-time asset generation (docs/areas/11-art-visual-style.md §3.3).
//
// Runs from `predev` and `prebuild`, synthesises every texture the world uses, and writes them to
// `public/gen/` with a manifest. Nothing here is committed: the *code* is the asset, and the binary
// is a build product like `dist/`. That is the whole point of generating rather than authoring —
// a texture change is a reviewable diff, not an opaque blob, and the repository never grows.
//
// Doing it at build time rather than at runtime is the user's call and the right one: the noise
// synthesis below takes long enough that running it on a player's phone at boot would be plainly
// worse than downloading the result.
//
// Determinism is a requirement, not a nicety. The generators are seeded, the PNG encoder is
// deterministic, and the manifest records a signature of the recipe — so a rebuild that changes no
// source produces byte-identical output, and this script can skip its own work entirely.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { encodePng } from './png.mjs';

// Lets the extensionless imports inside `src/` resolve when Node loads them directly.
register('./ts-resolve.mjs', import.meta.url);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'gen');

/**
 * Bumped by hand whenever the *meaning* of the manifest changes, so a stale `public/gen` from an
 * older checkout is rejected rather than half-used. The recipe hash below catches parameter
 * changes; this catches shape changes the hash cannot see.
 */
const MANIFEST_VERSION = 1;

/**
 * Ceiling on the total generated payload, enforced below.
 *
 * An asset budget is only real if something fails when it is missed. These textures are downloaded
 * on top of a ~175 kB gzipped bundle, on connections this game is explicitly meant to work on
 * (docs/compatibility.md), so the budget is deliberately tight. Raising it is a decision someone
 * should have to make on purpose.
 */
const BUDGET_BYTES = 320 * 1024;

/**
 * The recipe. Resolutions are chosen per map rather than uniformly: albedo carries the detail the
 * eye actually reads, normals tolerate half the resolution once they are tiled, and roughness is
 * the broadest signal of the three. Uniform sizes here would triple the payload for no visible gain.
 */
const RECIPE = {
  concrete: { albedoSize: 256, normalSize: 128, roughnessSize: 128, seed: 20260726 },
};

function recipeSignature(texgenSource) {
  return createHash('sha256')
    .update(JSON.stringify(RECIPE))
    .update(String(MANIFEST_VERSION))
    // The generators themselves are part of the recipe: editing the noise without editing its
    // parameters must still invalidate the cache, or a developer sees stale textures and no reason.
    .update(texgenSource)
    .digest('hex')
    .slice(0, 16);
}

async function main() {
  const force = process.argv.includes('--force');
  const texgenPath = join(ROOT, 'src', 'render', 'three', 'texgen.ts');
  let texgen;
  try {
    // Node strips TypeScript types natively from 22.18 onward, which is what lets the build script
    // share the *same* tested generators the app's tests cover. See `engines` in package.json.
    texgen = await import(texgenPath);
  } catch (error) {
    console.error('gen-assets: could not load texgen.ts — Node 22.18+ is required (native type stripping).');
    throw error;
  }

  const signature = recipeSignature(readFileSync(texgenPath, 'utf8'));
  const manifestPath = join(OUT_DIR, 'manifest.json');
  if (!force && existsSync(manifestPath)) {
    try {
      const existing = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (existing.version === MANIFEST_VERSION && existing.signature === signature) {
        console.log(`gen-assets: up to date (${signature})`);
        return;
      }
    } catch {
      // An unreadable manifest is not an error; it just means the cache is worthless. Regenerate.
    }
  }

  // The noise lattice is fixed by the seed, not by the output resolution, so asking for a smaller
  // concrete set gives the *same* texture sampled more coarsely rather than a different one. That
  // is what makes per-map resolutions safe: the normal still describes the albedo it sits under.
  const surfaces = new Map();
  const surfaceAt = (size) => {
    let set = surfaces.get(size);
    if (set === undefined) {
      set = texgen.concrete(size, RECIPE.concrete.seed);
      surfaces.set(size, set);
    }
    return set;
  };

  const bitmaps = {
    concreteAlbedo: surfaceAt(RECIPE.concrete.albedoSize).albedo,
    concreteNormal: surfaceAt(RECIPE.concrete.normalSize).normal,
    concreteRoughness: surfaceAt(RECIPE.concrete.roughnessSize).roughness,
  };

  // A clean slate, so a renamed or dropped texture cannot linger and be served forever.
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const textures = {};
  let total = 0;
  for (const [key, bitmap] of Object.entries(bitmaps)) {
    const file = `${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}.png`;
    const png = encodePng(bitmap);
    writeFileSync(join(OUT_DIR, file), png);
    textures[key] = { file, bytes: png.length, size: bitmap.width };
    total += png.length;
  }

  writeFileSync(manifestPath, `${JSON.stringify({ version: MANIFEST_VERSION, signature, textures }, null, 2)}\n`);

  const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
  for (const [key, meta] of Object.entries(textures)) console.log(`  ${key.padEnd(18)} ${meta.size}px  ${kb(meta.bytes)}`);
  console.log(`gen-assets: ${Object.keys(textures).length} textures, ${kb(total)} of ${kb(BUDGET_BYTES)}`);

  if (total > BUDGET_BYTES) {
    console.error(
      `gen-assets: over budget by ${kb(total - BUDGET_BYTES)}. Shrink a map or drop one; raising ` +
        'BUDGET_BYTES is a deliberate decision, not a fix.',
    );
    process.exitCode = 1;
  }
}

await main();
