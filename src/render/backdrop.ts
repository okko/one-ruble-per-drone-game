/**
 * Shared menu/credits/gameplay backdrop (docs/areas/11-art-visual-style.md §3.5). A small, PURE
 * `Renderer`-only helper: a day/night sky (palette keys selected by `daylight`), a sun/moon sprite,
 * and three parallax silhouette layers (far onion domes → mid brutalist towers → near rooftop). No
 * new hex — day/night blends by CHOOSING palette keys per threshold. `parallax` drifts the layers
 * (attract mode); `dim` darkens everything so overlaid text stays readable (credits). No state, no RNG.
 */
import type { Renderer } from './renderer';
import type { PaletteKey } from './palette';

export interface SkylineOpts {
  phase?: 'day' | 'night';
  /** Horizontal offset (px) for a subtle parallax drift in attract mode. */
  parallax?: number;
  /** Darken the silhouette + drop the sun/windows so overlaid text reads (credits). */
  dim?: boolean;
  /** Continuous daylight 0..1 (1 = full day). Defaults from `phase`. */
  daylight?: number;
}

interface Building {
  x: number;
  w: number;
  h: number;
  dome?: PaletteKey;
}

// Far layer: low, distant onion-dome skyline.
const FAR: readonly Building[] = [
  { x: 8, w: 22, h: 30, dome: 'domeGold' },
  { x: 44, w: 26, h: 24 },
  { x: 86, w: 20, h: 34, dome: 'domeTeal' },
  { x: 120, w: 28, h: 26 },
  { x: 168, w: 22, h: 32, dome: 'domeRed' },
  { x: 208, w: 26, h: 24 },
  { x: 256, w: 22, h: 34, dome: 'domeGold' },
  { x: 300, w: 28, h: 26 },
  { x: 344, w: 24, h: 30, dome: 'domeTeal' },
];

// Mid layer: taller brutalist towers.
const MID: readonly Building[] = [
  { x: -4, w: 28, h: 52 },
  { x: 36, w: 22, h: 70 },
  { x: 92, w: 30, h: 46 },
  { x: 134, w: 24, h: 64 },
  { x: 184, w: 30, h: 56 },
  { x: 230, w: 22, h: 72 },
  { x: 268, w: 34, h: 50 },
  { x: 320, w: 26, h: 66 },
  { x: 360, w: 28, h: 54 },
];

function skyKeys(daylight: number): [PaletteKey, PaletteKey, PaletteKey] {
  if (daylight >= 0.45) return ['skyDayTop', 'skyDayMid', 'skyDayLow'];
  if (daylight >= 0.2) return ['skyNightMid', 'skyDayMid', 'skyDayLow']; // dawn / dusk
  return ['skyNightTop', 'skyNightMid', 'shadow']; // night
}

function drawLayer(
  r: Renderer,
  layer: readonly Building[],
  offset: number,
  body: PaletteKey,
  litWindows: boolean,
  dim: boolean,
): void {
  const groundY = r.height - 4;
  for (const b of layer) {
    const bx = Math.round(b.x + offset);
    r.fillRect(bx, groundY - b.h, b.w, b.h, body);
    if (dim) continue;
    if (b.dome) r.fillRect(bx + Math.floor(b.w / 2) - 2, groundY - b.h - 4, 4, 4, b.dome);
    r.fillRect(bx + 3, groundY - b.h + 4, 2, 2, litWindows ? 'windowLit' : 'windowDark');
    r.fillRect(bx + b.w - 5, groundY - b.h + 10, 2, 2, litWindows ? 'windowLit' : 'windowDark');
  }
}

export function drawSkyline(r: Renderer, opts: SkylineOpts = {}): void {
  const daylight = opts.daylight ?? (opts.phase === 'night' ? 0 : 1);
  const dim = opts.dim ?? false;
  const offset = opts.parallax ?? 0;
  const lit = daylight < 0.45; // lit windows at dusk/night
  const [top, mid, low] = skyKeys(daylight);

  // Sky gradient (three bands, top → horizon).
  r.clear(top);
  r.fillRect(0, Math.floor(r.height * 0.45), r.width, Math.ceil(r.height * 0.3), mid);
  r.fillRect(0, Math.floor(r.height * 0.7), r.width, r.height, low);

  // Sun (day) / moon (night), unless dimmed for a text overlay.
  if (!dim) r.drawSprite(daylight < 0.4 ? 'bg.moon' : 'bg.sun', { x: r.width - 40, y: 30 });

  // Parallax silhouettes, back → front.
  const far: PaletteKey = dim ? 'ink' : lit ? 'shadow' : 'concrete';
  const midColor: PaletteKey = dim ? 'ink' : 'concreteDk';
  drawLayer(r, FAR, offset * 0.1, far, lit, dim);
  drawLayer(r, MID, offset * 0.3, midColor, lit, dim);

  // Near layer: the rooftop edge / sandbag line along the very bottom.
  if (!dim) {
    const ny = r.height - 6;
    r.fillRect(0, ny, r.width, 6, 'uniformDk');
    for (let x = Math.round((offset * 0.6) % 16) - 16; x < r.width; x += 16) {
      r.fillRect(x, ny - 2, 8, 3, 'uniform');
    }
  }
}
