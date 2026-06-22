/**
 * Grid helper: build a `PixelGrid` of an exact width by right-padding (or truncating) every row to
 * `w`. Lets sprite files author rows without hand-counting trailing spaces — the result is always
 * rectangular at `w × rows.length`, which the rasteriser requires and the art-data test enforces.
 */
import type { ArtEntry, PixelGrid } from './types';
import type { PaletteKey } from '../palette';

export function mk(w: number, rows: string[], legend: Record<string, PaletteKey>): PixelGrid {
  return { rows: rows.map((r) => (r + ' '.repeat(w)).slice(0, w)), legend };
}

/** Like `mk` but also pads/truncates the row COUNT to exactly `h` (bottom-padded with blank rows). */
export function mkh(w: number, h: number, rows: string[], legend: Record<string, PaletteKey>): PixelGrid {
  const out = rows.map((r) => (r + ' '.repeat(w)).slice(0, w));
  while (out.length < h) out.push(' '.repeat(w));
  return { rows: out.slice(0, h), legend };
}

/** A static (1-frame) sprite entry from a grid, with optional explicit pivot. */
export function sprite(grid: PixelGrid, pivot?: [number, number]): ArtEntry {
  return {
    kind: 'sprite',
    w: grid.rows[0]?.length ?? 0,
    h: grid.rows.length,
    frames: [grid],
    ...(pivot ? { pivot } : {}),
  };
}

/** A multi-frame sprite entry; all grids must share the same w×h. */
export function anim(grids: PixelGrid[], fps: number, pivot?: [number, number]): ArtEntry {
  const g0 = grids[0];
  return {
    kind: 'sprite',
    w: g0?.rows[0]?.length ?? 0,
    h: g0?.rows.length ?? 0,
    frames: grids,
    fps,
    ...(pivot ? { pivot } : {}),
  };
}
