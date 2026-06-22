/**
 * Pixel-art data types (docs/areas/11-art-visual-style.md). Sprites are authored as palette-indexed
 * grids — the same representation `src/ui/hud/icons.ts` pioneered for the meter icons: each row is a
 * string, each non-space char maps via `legend` to a `PaletteKey`, a space is transparent. No hex
 * literals live here; the grids are pure data, rasterised into the in-memory atlas at boot
 * (`render/atlas`). An `ArtEntry` is either a (possibly multi-frame) sprite or a bitmap font strip.
 */
import type { PaletteKey } from '../palette';

export interface PixelGrid {
  /** Equal-length strings; `' '` = transparent. */
  rows: string[];
  /** Char → palette key for every non-space glyph used in `rows`. */
  legend: Record<string, PaletteKey>;
}

export type ArtEntry =
  | {
      kind: 'sprite';
      w: number; // single-frame width (must equal each frame grid's column count)
      h: number; // single-frame height (must equal each frame grid's row count)
      frames: PixelGrid[]; // ≥1; all the same w×h, laid out horizontally in the atlas
      fps?: number; // animation rate (docs/areas/11 §3.8); omitted for static sprites
      pivot?: [number, number]; // explicit pivot; omitted → provider default (center / center-bottom)
    }
  | {
      kind: 'font';
      glyphW: number;
      glyphH: number;
      firstCharCode: number; // codepoint of glyphs[0]
      glyphs: PixelGrid[]; // one grid per codepoint from firstCharCode upward
    };
