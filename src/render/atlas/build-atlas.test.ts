// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildAtlasManifest } from './rasterize';
import { createManifestProvider, createPlaceholderProvider } from '../sprite-provider';
import { validateAssetManifest } from '../../content/assets-validate';
import { ART } from '../art/index';
import { SPRITE_IDS } from '../../content/sprite-ids';

// The DOM canvas assembly in build-atlas.ts is exercised by the Playwright matrix; here we test the
// pure manifest it generates and how the wrapped provider maps finished vs unfinished ids.
describe('in-memory atlas manifest', () => {
  it('resolves finished ids to the atlas and unfinished ids to the placeholder', () => {
    const manifest = buildAtlasManifest(ART);
    const provider = createManifestProvider(manifest, createPlaceholderProvider());
    expect(provider.resolve('icon.poo').source).toBe('atlas'); // authored in ART
    expect(provider.resolve('portrait.ivan').source).toBe('placeholder'); // dynamic id, never in ART
  });

  it('produces a manifest that validates against the asset schema (bounds, types)', () => {
    expect(() => validateAssetManifest(buildAtlasManifest(ART))).not.toThrow();
  });

  it('backs every fixed sprite id with real atlas art (art is complete)', () => {
    const manifest = buildAtlasManifest(ART);
    for (const id of SPRITE_IDS) {
      expect(id in manifest.sprites, `${id} authored`).toBe(true);
    }
  });
});
