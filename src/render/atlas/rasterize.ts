/**
 * Pure raster + atlas-layout math (docs/areas/11-art-visual-style.md §5) — no DOM, no canvas, so it
 * is fully node-testable and coverage-gated. `rasterizeGrid` turns a palette-indexed grid into RGBA
 * pixels; `tintRGBA` flat-recolours opaque pixels (for `drone.special` / `ui.meter.fill` / font);
 * `planAtlasLayout` shelf-packs every art entry (frames laid horizontally so the existing
 * `createManifestProvider` frame math + the manifest validator stay valid) and emits the per-id
 * `SpriteDef`s for an in-memory manifest. The DOM assembly (canvas) lives in `build-atlas.ts`.
 */
import type { PaletteKey } from '../palette';
import type { ArtEntry, PixelGrid } from '../art/types';
import type { SpriteId } from '../../content/sprite-ids';
import type { AssetManifest, SpriteDef } from '../../content/assets';

export interface RasterImage {
  width: number;
  height: number;
  // RGBA, row-major; transparent pixels are (0,0,0,0). ArrayBuffer-backed so it feeds `new ImageData`.
  data: Uint8ClampedArray<ArrayBuffer>;
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/** Rasterise one grid to RGBA. Throws on ragged rows or a char missing from the legend. */
export function rasterizeGrid(grid: PixelGrid, palette: Record<PaletteKey, string>): RasterImage {
  const height = grid.rows.length;
  const width = grid.rows[0]?.length ?? 0;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = grid.rows[y] ?? '';
    if (row.length !== width) {
      throw new Error(`rasterizeGrid: ragged row ${y} (len ${row.length} != ${width})`);
    }
    for (let x = 0; x < width; x++) {
      const ch = row.charAt(x);
      if (ch === ' ') continue; // transparent
      const key = grid.legend[ch];
      if (key === undefined) throw new Error(`rasterizeGrid: char '${ch}' not in legend`);
      const [r, g, b] = hexToRgb(palette[key]);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

/**
 * Flat tint: recolour every opaque pixel to `hex`, preserving alpha. Returns a fresh ArrayBuffer-backed
 * image, so it accepts both a `RasterImage` and a canvas `ImageData` (whose `data` is ArrayBufferLike).
 */
export function tintRGBA(img: { width: number; height: number; data: Uint8ClampedArray }, hex: string): RasterImage {
  const [r, g, b] = hexToRgb(hex);
  const data = new Uint8ClampedArray(img.data);
  for (let i = 0; i < data.length; i += 4) {
    if ((data[i + 3] ?? 0) !== 0) {
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
    }
  }
  return { width: img.width, height: img.height, data };
}

export interface AtlasSlot {
  id: SpriteId;
  /** Manifest entry with `x`/`y` assigned; frames lie at `x + frame*w` (horizontal). */
  def: SpriteDef;
}
export interface AtlasLayout {
  width: number;
  height: number;
  slots: AtlasSlot[];
}

const GUTTER = 1; // 1px gap between packed footprints (defensive against sampling bleed)

/** Footprint (atlas px) an entry occupies: frames/glyphs laid horizontally. */
function footprint(entry: ArtEntry): { w: number; h: number } {
  if (entry.kind === 'font') {
    return { w: entry.glyphs.length * entry.glyphW, h: entry.glyphH };
  }
  return { w: entry.frames.length * entry.w, h: entry.h };
}

function defFor(entry: ArtEntry, x: number, y: number): SpriteDef {
  if (entry.kind === 'font') {
    return {
      x,
      y,
      w: entry.glyphs.length * entry.glyphW,
      h: entry.glyphH,
      font: { glyphW: entry.glyphW, glyphH: entry.glyphH, firstCharCode: entry.firstCharCode },
    };
  }
  return {
    x,
    y,
    w: entry.w,
    h: entry.h,
    ...(entry.pivot ? { pivot: entry.pivot } : {}),
    ...(entry.frames.length > 1
      ? { anim: { frames: entry.frames.length, fps: entry.fps ?? 8, layout: 'horizontal' as const } }
      : {}),
  };
}

/**
 * Deterministic shelf-pack: stable id order, tallest-first, wrapping at a width that always fits the
 * widest single footprint (font strips can exceed 512px, which is fine for an in-memory canvas).
 */
export function planAtlasLayout(art: Partial<Record<SpriteId, ArtEntry>>): AtlasLayout {
  const entries = Object.keys(art)
    .sort()
    .map((id) => ({ id: id as SpriteId, entry: art[id as SpriteId] as ArtEntry, fp: footprint(art[id as SpriteId] as ArtEntry) }));

  const maxWidth = Math.max(256, ...entries.map((e) => e.fp.w));
  // Tallest-first improves shelf packing; tie-break by id for determinism.
  entries.sort((a, b) => b.fp.h - a.fp.h || (a.id < b.id ? -1 : 1));

  const slots: AtlasSlot[] = [];
  let cursorX = 0;
  let shelfY = 0;
  let shelfH = 0;
  let usedWidth = 0;
  for (const { id, entry, fp } of entries) {
    if (cursorX + fp.w > maxWidth) {
      shelfY += shelfH + GUTTER;
      cursorX = 0;
      shelfH = 0;
    }
    slots.push({ id, def: defFor(entry, cursorX, shelfY) });
    cursorX += fp.w + GUTTER;
    shelfH = Math.max(shelfH, fp.h);
    usedWidth = Math.max(usedWidth, cursorX - GUTTER);
  }
  return { width: usedWidth, height: shelfY + shelfH, slots };
}

/**
 * Build an in-memory `AssetManifest` from the art layout (PURE). The renderer's atlas is wrapped by
 * the existing `createManifestProvider` against this manifest, so atlas ids resolve to `source:'atlas'`
 * rects and unfinished ids delegate to the placeholder — no provider-contract change.
 */
export function buildAtlasManifest(art: Partial<Record<SpriteId, ArtEntry>>): AssetManifest {
  const layout = planAtlasLayout(art);
  const sprites: Record<string, SpriteDef> = {};
  for (const slot of layout.slots) sprites[slot.id] = slot.def;
  return {
    version: 1,
    atlas: { image: '(in-memory)', width: Math.max(1, layout.width), height: Math.max(1, layout.height) },
    sprites,
  };
}
