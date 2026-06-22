/**
 * In-memory sprite atlas (docs/areas/11-art-visual-style.md §5/§7). DOM edge (like canvas-renderer):
 * rasterises the pure `{rows,legend}` art grids onto one offscreen canvas at boot, synchronously (no
 * network, no image decode), and wraps the generated manifest with the existing `createManifestProvider`
 * so the renderer blits real pixels for finished ids and falls back to the placeholder for the rest.
 * Not unit-tested here — the pure manifest/layout/raster math is gated in `rasterize.ts`; the canvas
 * assembly + blit are exercised by the Playwright matrix.
 */
import { PALETTE } from '../palette';
import { ART } from '../art/index';
import { buildAtlasManifest, rasterizeGrid } from './rasterize';
import { createManifestProvider, createPlaceholderProvider, type SpriteProvider } from '../sprite-provider';
import type { ArtEntry } from '../art/types';
import type { SpriteId } from '../../content/sprite-ids';
import type { PaletteKey } from '../palette';

export interface ArtAtlas {
  canvas: HTMLCanvasElement;
  provider: SpriteProvider;
}

function paintEntry(
  ctx: CanvasRenderingContext2D,
  entry: ArtEntry,
  x: number,
  y: number,
  palette: Record<PaletteKey, string>,
): void {
  const grids = entry.kind === 'font' ? entry.glyphs : entry.frames;
  const cellW = entry.kind === 'font' ? entry.glyphW : entry.w;
  grids.forEach((grid, i) => {
    const img = rasterizeGrid(grid, palette);
    if (img.width === 0 || img.height === 0) return;
    ctx.putImageData(new ImageData(img.data, img.width, img.height), x + i * cellW, y);
  });
}

export function createArtAtlas(
  art: Partial<Record<SpriteId, ArtEntry>> = ART,
  palette: Record<PaletteKey, string> = PALETTE,
  placeholder: SpriteProvider = createPlaceholderProvider(),
): ArtAtlas {
  const manifest = buildAtlasManifest(art);
  const canvas = document.createElement('canvas');
  canvas.width = manifest.atlas.width;
  canvas.height = manifest.atlas.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('createArtAtlas: 2D context unavailable');
  ctx.imageSmoothingEnabled = false;

  for (const [id, def] of Object.entries(manifest.sprites)) {
    const entry = art[id as SpriteId];
    if (entry) paintEntry(ctx, entry, def.x, def.y, palette);
  }

  return { canvas, provider: createManifestProvider(manifest, placeholder) };
}
