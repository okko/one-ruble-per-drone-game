/**
 * Pure texture synthesis (docs/areas/11-art-visual-style.md §3.3).
 *
 * Everything here is plain arithmetic over typed arrays: no three.js, no canvas, no DOM. That is
 * deliberate. These functions run at BUILD time under node (`scripts/gen-assets.mjs` encodes their
 * output to PNG), which means the expensive work is paid once by the machine that builds rather
 * than on every player's first frame — and it means the whole thing is unit-testable and sits
 * inside the coverage and mutation gates like any other logic.
 *
 * ## Why the output is greyscale
 *
 * None of these maps carry hue. They are *detail* — the variation a flat colour lacks — and the
 * colour itself stays where it already lives, in `theme.ts`. A material gets `color` from the
 * palette and `map` from here, and the two multiply. One concrete texture therefore serves
 * `concrete`, `concreteDk` and `shadow` alike, the palette remains the single source of truth for
 * colour, and re-tinting the world stays a one-line change in the theme rather than a rebuild of
 * the asset set.
 *
 * ## Why everything tiles
 *
 * These maps repeat across surfaces far larger than themselves. A generator that does not wrap
 * produces a visible seam every time it repeats, which is worse than no texture at all. Every
 * function here wraps in both axes, and the tests assert it.
 *
 * Indexed reads are asserted with `as number` throughout: `noUncheckedIndexedAccess` widens typed
 * array access to `number | undefined`, but every index in this file is derived from the array's
 * own dimensions and is in range by construction. Writing `?? 0` instead would add a branch that
 * no test could ever reach.
 */

import { createRng } from '../../core/rng';

/** A raw image: row-major, top-left origin, 8 bits per channel. */
export interface Bitmap {
  readonly width: number;
  readonly height: number;
  /** 1 for greyscale, 3 for RGB. There is no alpha here; nothing generated needs one. */
  readonly channels: 1 | 3;
  readonly data: Uint8ClampedArray;
}

/** Hermite ease used for lattice interpolation — value noise with linear blending shows its grid. */
function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Round to a byte. `Uint8ClampedArray` clamps on store, so only the rounding is done here. */
function byte(v: number): number {
  return Math.round(v * 255);
}

/**
 * Seamless value noise: a `cells × cells` lattice of random values, smoothly interpolated over a
 * `size × size` field. Lattice indices wrap, so the field tiles.
 *
 * Returns values in [0, 1].
 */
export function tilingValueNoise(size: number, cells: number, seed: number): Float64Array {
  const n = Math.max(1, Math.floor(size));
  const c = Math.max(1, Math.floor(cells));
  const rng = createRng(seed);
  const lattice = new Float64Array(c * c);
  for (let i = 0; i < lattice.length; i += 1) lattice[i] = rng.next();

  const out = new Float64Array(n * n);
  const scale = c / n;
  for (let y = 0; y < n; y += 1) {
    const fy = y * scale;
    const iy = Math.floor(fy);
    const ty = ease(fy - iy);
    const y0 = iy % c;
    const y1 = (y0 + 1) % c;
    for (let x = 0; x < n; x += 1) {
      const fx = x * scale;
      const ix = Math.floor(fx);
      const tx = ease(fx - ix);
      const x0 = ix % c;
      const x1 = (x0 + 1) % c;
      const top = lerp(lattice[y0 * c + x0] as number, lattice[y0 * c + x1] as number, tx);
      const bottom = lerp(lattice[y1 * c + x0] as number, lattice[y1 * c + x1] as number, tx);
      out[y * n + x] = lerp(top, bottom, ty);
    }
  }
  return out;
}

/**
 * Fractal sum of `tilingValueNoise`: each octave doubles the lattice and halves the amplitude.
 *
 * Every octave uses a lattice size that divides the field evenly, so the sum still tiles. The
 * result is normalised back into [0, 1] by the total amplitude, which keeps the contrast of the
 * output independent of the octave count — otherwise adding detail would quietly wash the map out.
 */
export function tilingFbm(size: number, cells: number, octaves: number, seed: number): Float64Array {
  const n = Math.max(1, Math.floor(size));
  const layers = Math.max(1, Math.floor(octaves));
  const out = new Float64Array(n * n);
  let amplitude = 1;
  let total = 0;
  for (let o = 0; o < layers; o += 1) {
    const layer = tilingValueNoise(n, cells * 2 ** o, seed + o * 7919);
    for (let i = 0; i < out.length; i += 1) out[i] = (out[i] as number) + (layer[i] as number) * amplitude;
    total += amplitude;
    amplitude /= 2;
  }
  for (let i = 0; i < out.length; i += 1) out[i] = (out[i] as number) / total;
  return out;
}

/**
 * Derive a tangent-space normal map from a height field by central differences.
 *
 * Neighbour lookups wrap, so a tiling height field yields a tiling normal map. Output is the usual
 * OpenGL-convention encoding three.js expects: +X right, +Y up, +Z out of the surface, each mapped
 * from [-1, 1] into [0, 255].
 */
export function heightToNormal(height: Float64Array, size: number, strength: number): Bitmap {
  const n = Math.max(1, Math.floor(size));
  const data = new Uint8ClampedArray(n * n * 3);
  for (let y = 0; y < n; y += 1) {
    const up = ((y - 1 + n) % n) * n;
    const down = ((y + 1) % n) * n;
    const row = y * n;
    for (let x = 0; x < n; x += 1) {
      const left = (x - 1 + n) % n;
      const right = (x + 1) % n;
      const dx = ((height[row + right] as number) - (height[row + left] as number)) * strength;
      const dy = ((height[down + x] as number) - (height[up + x] as number)) * strength;
      // The gradient points uphill, so the surface normal leans the other way.
      const len = Math.hypot(dx, dy, 1);
      const o = (row + x) * 3;
      data[o] = byte((-dx / len) * 0.5 + 0.5);
      data[o + 1] = byte((-dy / len) * 0.5 + 0.5);
      data[o + 2] = byte(1 / len * 0.5 + 0.5);
    }
  }
  return { width: n, height: n, channels: 3, data };
}

/** Wrap a [0, 1] field as a greyscale bitmap, remapped into `[low, high]`. */
export function greyscale(field: Float64Array, size: number, low: number, high: number): Bitmap {
  const n = Math.max(1, Math.floor(size));
  const data = new Uint8ClampedArray(n * n);
  for (let i = 0; i < data.length; i += 1) data[i] = byte(low + (high - low) * (field[i] as number));
  return { width: n, height: n, channels: 1, data };
}

/** The three maps that make a surface out of a flat colour. */
export interface SurfaceMaps {
  /** Multiplies the material's palette colour. Centred near white so the tint survives. */
  albedo: Bitmap;
  normal: Bitmap;
  /** Read from the green channel by three.js; greyscale gives that for free. */
  roughness: Bitmap;
}

/**
 * Weathered cast concrete: the skyline, the tower shell, the roof deck and the parapet.
 *
 * Two fields do the work. A coarse fbm is the large-scale staining and pour variation — the thing
 * that stops a wall reading as one flat rectangle at distance. A finer, sharper field is the
 * aggregate and pitting that only shows up close, and it also drives roughness, so the dark stains
 * read as damp rather than merely darker.
 */
export function concrete(size: number, seed: number): SurfaceMaps {
  const n = Math.max(1, Math.floor(size));
  const stain = tilingFbm(n, 3, 4, seed);
  const grain = tilingFbm(n, 16, 3, seed + 104729);

  const shade = new Float64Array(n * n);
  const relief = new Float64Array(n * n);
  const rough = new Float64Array(n * n);
  for (let i = 0; i < shade.length; i += 1) {
    const s = stain[i] as number;
    const g = grain[i] as number;
    // Kept in a narrow band around white: this multiplies the palette colour, so a wide range here
    // would read as dirt rather than as concrete and would fight the theme.
    shade[i] = 0.72 + 0.28 * (s * 0.65 + g * 0.35);
    relief[i] = g * 0.7 + s * 0.3;
    // Wetter where it is darker, and the fine grain scatters on top.
    rough[i] = 0.55 + 0.45 * (1 - s) * 0.6 + 0.15 * g;
  }

  return {
    albedo: greyscale(shade, n, 0, 1),
    normal: heightToNormal(relief, n, 2.2),
    roughness: greyscale(rough, n, 0.45, 1),
  };
}

/** Shape of the window grid. See `windowGrid`. */
export interface WindowGridOptions {
  /** Output edge length in pixels. */
  size: number;
  /** Panes across one repeat of the texture. */
  columns: number;
  /** Panes down one repeat of the texture. */
  rows: number;
  /** Share of each cell given over to the frame between panes, split across its two edges. */
  mullion: number;
  /** Share of panes left unlit. Nobody is home on every floor at once. */
  darkFraction: number;
  seed: number;
}

/**
 * A tiling grid of lit windows, as an emissive mask: 0 in the frame, bright in the glass.
 *
 * ## Why the grid is small and repeated rather than large and unique
 *
 * A skyline band is a different size on every tier of every tower, so the number of windows it
 * should show cannot be baked into the texture — it is settled at runtime by the map's `repeat`,
 * from the band's own world size. The texture therefore holds a handful of panes and is tiled to
 * whatever density the surface calls for, which is also why a 4×4 grid at 128px looks sharper here
 * than a 16×16 grid at 512px would.
 *
 * It has two dimensions rather than one for the same reason a brick wall is not stripes: a single
 * row repeated up a tower puts every dark window in a vertical line, and the eye finds that
 * instantly. A square block of hashed panes repeats too, but at a period nothing reads as a pattern.
 *
 * ## Why the lit/dark pattern is hashed rather than random per pixel
 *
 * Panes are drawn from a seeded table indexed by cell, so the pattern is periodic with the grid and
 * the texture tiles. Which windows are dark is the single strongest cue that a building is lived in
 * rather than extruded, and it costs nothing.
 */
export function windowGrid(options: WindowGridOptions): Bitmap {
  const n = Math.max(1, Math.floor(options.size));
  const cols = Math.max(1, Math.floor(options.columns));
  const rows = Math.max(1, Math.floor(options.rows));
  // Half the frame sits at each edge of a cell, so adjacent panes share a frame of the full width
  // and the frame at the tile seam is the same thickness as every other.
  const edge = Math.min(0.49, Math.max(0, options.mullion) / 2);
  const rng = createRng(options.seed);

  const lit = new Float64Array(cols * rows);
  for (let i = 0; i < lit.length; i += 1) {
    // Two draws per pane whatever the outcome, so the darkness roll cannot shift the brightness
    // sequence — otherwise changing `darkFraction` would repaint every window, not just some.
    const dark = rng.next() < options.darkFraction;
    const brightness = 0.55 + 0.45 * rng.next();
    lit[i] = dark ? 0 : brightness;
  }

  const data = new Uint8ClampedArray(n * n);
  for (let y = 0; y < n; y += 1) {
    // Sampled at the pixel's centre, not its corner. On a corner the frame at the far edge of a
    // cell lands exactly on the boundary and rounds away, so every pane ends up with a frame on one
    // side and none on the other — and the tile seam gets half a mullion.
    const cellY = ((y + 0.5) * rows) / n;
    const row = Math.min(rows - 1, Math.floor(cellY));
    const v = cellY - row;
    // Brighter at the top of the pane: a room is lit from its ceiling, and the gradient is what
    // separates a window from a rectangle at the distance this is seen from.
    const falloff = 1 - 0.42 * v;
    const inFrameV = v < edge || v > 1 - edge;
    for (let x = 0; x < n; x += 1) {
      const cellX = ((x + 0.5) * cols) / n;
      const col = Math.min(cols - 1, Math.floor(cellX));
      const u = cellX - col;
      const value =
        inFrameV || u < edge || u > 1 - edge ? 0 : (lit[row * cols + col] as number) * falloff;
      data[y * n + x] = byte(value);
    }
  }
  return { width: n, height: n, channels: 1, data };
}
