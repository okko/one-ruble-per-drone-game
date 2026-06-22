/**
 * Shared menu/credits backdrop (docs/areas/07-main-menu.md §3.2, docs/areas/12-credits.md §3.1). A
 * small, PURE draw helper — a gradient sky, a sun/moon, and a fixed Moscow-skyline silhouette — so
 * the menu, credits, highscore screens, and the attract reel share one continuous look without a
 * bespoke Art asset. No state and no RNG: the silhouette is a fixed profile; `parallax` shifts it
 * horizontally and `dim` darkens it so overlaid text stays readable (credits §3.1).
 */
import type { Renderer } from './renderer';
import type { PaletteKey } from './palette';

export interface SkylineOpts {
  phase?: 'day' | 'night';
  /** Horizontal offset (px) for a subtle parallax drift in attract mode. */
  parallax?: number;
  /** Darken the silhouette + drop the sun/windows so overlaid text reads (credits). */
  dim?: boolean;
}

interface Building {
  x: number;
  w: number;
  h: number;
  dome?: PaletteKey;
}

// Fixed silhouette spanning the 384-wide surface; a few onion domes nod at the Moscow skyline.
const SKYLINE: readonly Building[] = [
  { x: -4, w: 28, h: 46 },
  { x: 30, w: 22, h: 64, dome: 'domeGold' },
  { x: 58, w: 30, h: 38 },
  { x: 92, w: 20, h: 72 },
  { x: 118, w: 34, h: 52, dome: 'domeTeal' },
  { x: 158, w: 24, h: 40 },
  { x: 188, w: 30, h: 66 },
  { x: 224, w: 22, h: 48, dome: 'domeRed' },
  { x: 252, w: 36, h: 58 },
  { x: 294, w: 26, h: 42 },
  { x: 326, w: 30, h: 70, dome: 'domeGold' },
  { x: 362, w: 24, h: 50 },
];

export function drawSkyline(r: Renderer, opts: SkylineOpts = {}): void {
  const night = opts.phase === 'night';
  const offset = opts.parallax ?? 0;
  const dim = opts.dim ?? false;

  // Sky gradient (three bands, top → horizon).
  r.clear(night ? 'skyNightTop' : 'skyDayTop');
  r.fillRect(0, Math.floor(r.height * 0.45), r.width, Math.ceil(r.height * 0.3), night ? 'skyNightMid' : 'skyDayMid');
  r.fillRect(0, Math.floor(r.height * 0.7), r.width, r.height, night ? 'shadow' : 'skyDayLow');

  // Sun (day) / moon (night), unless dimmed for a text overlay.
  if (!dim) r.drawSprite(night ? 'bg.moon' : 'bg.sun', { x: r.width - 40, y: 30 });

  // Skyline silhouette along the bottom edge.
  const groundY = r.height - 4;
  const body: PaletteKey = dim ? 'ink' : night ? 'concreteDk' : 'concrete';
  for (const b of SKYLINE) {
    const bx = Math.round(b.x + offset);
    r.fillRect(bx, groundY - b.h, b.w, b.h, body);
    if (!dim) {
      if (b.dome) r.fillRect(bx + Math.floor(b.w / 2) - 2, groundY - b.h - 4, 4, 4, b.dome);
      r.fillRect(bx + 2, groundY - b.h + 3, 2, 2, night ? 'windowLit' : 'windowDark');
    }
  }
}
