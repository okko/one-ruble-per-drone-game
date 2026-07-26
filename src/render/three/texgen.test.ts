import { describe, expect, it } from 'vitest';

import {
  concrete,
  greyscale,
  heightToNormal,
  tilingFbm,
  tilingValueNoise,
  windowGrid,
  type Bitmap,
} from './texgen';

const SIZE = 32;

/** Read channel `c` at (x, y). */
function at(bmp: Bitmap, x: number, y: number, c = 0): number {
  return bmp.data[(y * bmp.width + x) * bmp.channels + c] ?? -1;
}

/**
 * The seam test: crossing the wrap must be no more of a jump than the largest step inside the row.
 *
 * Comparing against the row's own worst interior step rather than a fixed tolerance keeps this
 * honest at any frequency — a high-octave field has large steps everywhere, and the point is only
 * that the wrap is not a *special* one. Returns how much the wrap exceeds that; <= 0 means seamless.
 */
function seamExcess(field: Float64Array, size: number): number {
  let worst = -Infinity;
  for (let y = 0; y < size; y += 1) {
    let interior = 0;
    for (let x = 1; x < size; x += 1) {
      interior = Math.max(interior, Math.abs((field[y * size + x] ?? 0) - (field[y * size + x - 1] ?? 0)));
    }
    const wrap = Math.abs((field[y * size] ?? 0) - (field[y * size + size - 1] ?? 0));
    worst = Math.max(worst, wrap - interior);
  }
  return worst;
}

/** Direction reversals along the first row — a scale-free count of how much detail a field carries. */
function reversals(field: Float64Array, size: number): number {
  let count = 0;
  let previous = 0;
  for (let x = 1; x < size; x += 1) {
    const delta = (field[x] ?? 0) - (field[x - 1] ?? 0);
    if (delta !== 0 && previous !== 0 && Math.sign(delta) !== Math.sign(previous)) count += 1;
    if (delta !== 0) previous = delta;
  }
  return count;
}

describe('tilingValueNoise', () => {
  it('fills the requested field with values in [0, 1]', () => {
    const f = tilingValueNoise(SIZE, 4, 7);
    expect(f).toHaveLength(SIZE * SIZE);
    for (const v of f) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic for a seed, and different for a different one', () => {
    expect(Array.from(tilingValueNoise(SIZE, 4, 7))).toEqual(Array.from(tilingValueNoise(SIZE, 4, 7)));
    expect(Array.from(tilingValueNoise(SIZE, 4, 8))).not.toEqual(Array.from(tilingValueNoise(SIZE, 4, 7)));
  });

  it('wraps without a seam, because these maps repeat across a whole wall', () => {
    expect(seamExcess(tilingValueNoise(SIZE, 4, 3), SIZE)).toBeLessThanOrEqual(0);
  });

  it('actually varies rather than returning a constant field', () => {
    const f = tilingValueNoise(SIZE, 4, 11);
    expect(Math.max(...f) - Math.min(...f)).toBeGreaterThan(0.2);
  });

  it('survives degenerate sizes rather than producing an empty or negative field', () => {
    expect(tilingValueNoise(0, 0, 1)).toHaveLength(1);
    expect(tilingValueNoise(-4, -4, 1)).toHaveLength(1);
  });

  it('interpolates smoothly: a coarse lattice has no hard steps', () => {
    const f = tilingValueNoise(SIZE, 2, 5);
    let worst = 0;
    for (let i = 1; i < f.length; i += 1) worst = Math.max(worst, Math.abs((f[i] ?? 0) - (f[i - 1] ?? 0)));
    expect(worst).toBeLessThan(0.5);
  });
});

describe('tilingFbm', () => {
  it('stays in [0, 1] however many octaves are summed', () => {
    for (const octaves of [1, 3, 5]) {
      const f = tilingFbm(SIZE, 2, octaves, 4);
      expect(Math.min(...f)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...f)).toBeLessThanOrEqual(1);
    }
  });

  it('normalises by total amplitude, so adding detail does not wash the map out', () => {
    const spread = (f: Float64Array): number => Math.max(...f) - Math.min(...f);
    // Without the normalisation the four-octave sum would sit in a much narrower band around its
    // mean than the one-octave field; require it to keep most of its contrast instead.
    expect(spread(tilingFbm(SIZE, 2, 4, 4))).toBeGreaterThan(spread(tilingFbm(SIZE, 2, 1, 4)) * 0.4);
  });

  it('adds detail: more octaves means more direction changes across a row', () => {
    // Total variation is the wrong measure here — normalising by amplitude compresses the range, so
    // a detailed field can have a smaller sum of steps than a smooth one. Counting reversals asks
    // the question that actually matters and is immune to the scale of the field.
    expect(reversals(tilingFbm(SIZE, 2, 4, 9), SIZE)).toBeGreaterThan(reversals(tilingFbm(SIZE, 2, 1, 9), SIZE));
  });

  it('still tiles once the octaves are summed', () => {
    expect(seamExcess(tilingFbm(SIZE, 2, 4, 6), SIZE)).toBeLessThanOrEqual(0);
  });

  it('treats a zero or negative octave count as one octave rather than dividing by zero', () => {
    const f = tilingFbm(SIZE, 2, 0, 2);
    expect(f).toHaveLength(SIZE * SIZE);
    expect(f.every((v) => Number.isFinite(v))).toBe(true);
  });
});

describe('heightToNormal', () => {
  it('encodes a flat height field as the straight-up normal', () => {
    const flat = new Float64Array(SIZE * SIZE).fill(0.5);
    const n = heightToNormal(flat, SIZE, 2);
    expect(n.channels).toBe(3);
    expect(at(n, 3, 3, 0)).toBe(128);
    expect(at(n, 3, 3, 1)).toBe(128);
    expect(at(n, 3, 3, 2)).toBe(255);
  });

  it('leans the normal away from uphill, in the OpenGL convention three.js expects', () => {
    // A ramp rising to the right: the surface should face left, so red drops below the midpoint.
    const ramp = new Float64Array(SIZE * SIZE);
    for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) ramp[y * SIZE + x] = x / SIZE;
    const n = heightToNormal(ramp, SIZE, 4);
    expect(at(n, SIZE / 2, SIZE / 2, 0)).toBeLessThan(128);
    expect(at(n, SIZE / 2, SIZE / 2, 1)).toBe(128);
  });

  it('scales with strength: a stronger setting tilts the normal further', () => {
    const bumpy = tilingFbm(SIZE, 4, 2, 12);
    const gentle = heightToNormal(bumpy, SIZE, 1);
    const steep = heightToNormal(bumpy, SIZE, 8);
    // Blue is the up component; tilting further pushes it down.
    expect(at(steep, 5, 5, 2)).toBeLessThan(at(gentle, 5, 5, 2));
  });

  it('wraps at the edges, so a tiling height field gives a tiling normal map', () => {
    const ramp = new Float64Array(SIZE * SIZE);
    for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) ramp[y * SIZE + x] = x / SIZE;
    // Column 0 samples column SIZE-1 as its left neighbour; nothing may read out of bounds.
    expect(Number.isFinite(at(heightToNormal(ramp, SIZE, 2), 0, 0, 0))).toBe(true);
  });

  it('emits a unit-length normal at every texel', () => {
    const n = heightToNormal(tilingFbm(SIZE, 4, 2, 15), SIZE, 3);
    for (let i = 0; i < 40; i += 1) {
      const o = i * 3;
      const v = [0, 1, 2].map((c) => ((n.data[o + c] ?? 0) / 255) * 2 - 1);
      expect(Math.hypot(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0)).toBeCloseTo(1, 1);
    }
  });
});

describe('greyscale', () => {
  it('remaps the field into the requested band', () => {
    const field = Float64Array.from([0, 0.5, 1, 0]);
    const g = greyscale(field, 2, 0.2, 0.6);
    expect(g.channels).toBe(1);
    expect(g.data[0]).toBe(51);
    expect(g.data[2]).toBe(153);
  });
});

describe('concrete', () => {
  const maps = concrete(SIZE, 21);

  it('returns three maps at the requested size with the channel counts three.js wants', () => {
    expect(maps.albedo).toMatchObject({ width: SIZE, height: SIZE, channels: 1 });
    expect(maps.normal).toMatchObject({ width: SIZE, height: SIZE, channels: 3 });
    expect(maps.roughness).toMatchObject({ width: SIZE, height: SIZE, channels: 1 });
  });

  it('keeps the albedo near white, so it modulates the palette colour instead of replacing it', () => {
    const values = Array.from(maps.albedo.data);
    expect(Math.min(...values)).toBeGreaterThan(150);
    expect(Math.max(...values)).toBeLessThanOrEqual(255);
  });

  it('still varies enough to be worth having', () => {
    const values = Array.from(maps.albedo.data);
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(20);
  });

  it('keeps roughness high: cast concrete is never glossy', () => {
    expect(Math.min(...maps.roughness.data)).toBeGreaterThan(100);
  });

  it('is deterministic, so two builds produce byte-identical assets', () => {
    expect(Array.from(concrete(SIZE, 21).albedo.data)).toEqual(Array.from(maps.albedo.data));
    expect(Array.from(concrete(SIZE, 22).albedo.data)).not.toEqual(Array.from(maps.albedo.data));
  });
});

describe('windowGrid', () => {
  const base = { size: 64, columns: 8, rows: 4, mullion: 0.25, darkFraction: 0.3, seed: 5 };

  /** Runs of consecutive lit pixels along a row — i.e. how many panes that row actually shows. */
  function panes(bmp: Bitmap, y: number): number {
    let runs = 0;
    let inside = false;
    for (let x = 0; x < bmp.width; x += 1) {
      const lit = at(bmp, x, y) > 0;
      if (lit && !inside) runs += 1;
      inside = lit;
    }
    return runs;
  }

  /** The y at the middle of pane row `row`. */
  function rowMid(bmp: Bitmap, rows: number, row: number): number {
    return Math.floor(((row + 0.5) * bmp.height) / rows);
  }

  it('is a single-channel map at the requested size', () => {
    expect(windowGrid(base)).toMatchObject({ width: 64, height: 64, channels: 1 });
  });

  it('frames every pane, so the tile seam is a mullion like any other', () => {
    const grid = windowGrid({ ...base, darkFraction: 0 });
    const mid = rowMid(grid, base.rows, 0);
    expect(at(grid, 0, mid)).toBe(0);
    expect(at(grid, grid.width - 1, mid)).toBe(0);
    expect(at(grid, 4, 0)).toBe(0);
    expect(at(grid, 4, grid.height - 1)).toBe(0);
  });

  it('lays out exactly as many panes across as it was asked for', () => {
    const grid = windowGrid({ ...base, darkFraction: 0 });
    expect(panes(grid, rowMid(grid, base.rows, 1))).toBe(base.columns);
    expect(panes(windowGrid({ ...base, columns: 3, rows: 1, darkFraction: 0 }), 32)).toBe(3);
  });

  it('varies the pattern down the grid as well as across it, so dark windows are not stripes', () => {
    const grid = windowGrid({ ...base, rows: 4, darkFraction: 0.4, seed: 11 });
    const pattern = (row: number) => {
      const y = rowMid(grid, 4, row);
      return Array.from({ length: grid.width }, (_, x) => (at(grid, x, y) > 0 ? 1 : 0)).join('');
    };
    expect(new Set([pattern(0), pattern(1), pattern(2), pattern(3)]).size).toBeGreaterThan(1);
  });

  it('leaves some windows dark, because nobody is home on every floor at once', () => {
    const grid = windowGrid(base);
    let shown = 0;
    for (let row = 0; row < base.rows; row += 1) shown += panes(grid, rowMid(grid, base.rows, row));
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(base.columns * base.rows);
  });

  it('draws nothing at all when every window is dark', () => {
    const grid = windowGrid({ ...base, darkFraction: 1 });
    expect(Math.max(...grid.data)).toBe(0);
  });

  it('falls off down each pane, so a window is not a flat rectangle of paint', () => {
    const grid = windowGrid({ ...base, darkFraction: 0 });
    const cell = grid.height / base.rows;
    const x = Math.floor((grid.width / base.columns) * 0.5);
    const top = at(grid, x, Math.floor(cell * 0.25));
    const bottom = at(grid, x, Math.floor(cell * 0.8));
    expect(top).toBeGreaterThan(bottom);
    expect(bottom).toBeGreaterThan(0);
  });

  it('widens the frame as the mullion grows', () => {
    const thin = windowGrid({ ...base, mullion: 0.1, darkFraction: 0 });
    const thick = windowGrid({ ...base, mullion: 0.4, darkFraction: 0 });
    const count = (bmp: Bitmap) => bmp.data.reduce((n, v) => n + (v === 0 ? 1 : 0), 0);
    expect(count(thick)).toBeGreaterThan(count(thin));
  });

  it('keeps the same panes lit when only the darkness threshold moves', () => {
    // The brightness roll must not be consumed by the darkness roll, or re-tuning how many windows
    // are dark would silently repaint every remaining one.
    const some = windowGrid({ ...base, darkFraction: 0.3 });
    const none = windowGrid({ ...base, darkFraction: 0 });
    const y = rowMid(some, base.rows, 2);
    let matched = 0;
    for (let x = 0; x < some.width; x += 1) {
      const a = at(some, x, y);
      if (a > 0) {
        expect(a).toBe(at(none, x, y));
        matched += 1;
      }
    }
    expect(matched).toBeGreaterThan(0);
  });

  it('is deterministic, and a different seed lights different windows', () => {
    expect(Array.from(windowGrid(base).data)).toEqual(Array.from(windowGrid(base).data));
    expect(Array.from(windowGrid({ ...base, seed: 6 }).data)).not.toEqual(Array.from(windowGrid(base).data));
  });
});
