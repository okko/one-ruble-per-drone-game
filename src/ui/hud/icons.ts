/**
 * Procedural pixel-art HUD icons (docs/areas/10-hud-ui.md §3.2/§5/§10). The five meter indicators and
 * the ruble coin are drawn as deterministic 8×8 bitmaps via `fillRect` — NOT OS emoji glyphs, which
 * differ per engine and would break the per-engine icon-row snapshot (§8.16). The grids are the shared
 * art-data in `render/art/icons.ts` (also baked into the atlas behind the same `SpriteId`s); the HUD
 * draws them directly here so the pixel-exact snapshot geometry is unaffected. Keyed by `SpriteId`.
 */
import type { Renderer } from '../../render/renderer';
import type { SpriteId } from '../../content/sprite-ids';
import { ICON_GRIDS } from '../../render/art/icons';

/** Draw an 8×8 procedural icon at (x, y) at the given integer scale (1 px per cell by default). */
export function drawIcon(r: Renderer, id: SpriteId, x: number, y: number, scale = 1): void {
  const grid = ICON_GRIDS[id];
  if (!grid) return;
  grid.rows.forEach((row, ry) => {
    for (let cx = 0; cx < row.length; cx++) {
      const ch = row.charAt(cx);
      const color = ch === ' ' ? undefined : grid.legend[ch];
      if (color) r.fillRect(x + cx * scale, y + ry * scale, scale, scale, color);
    }
  });
}

/** Whether a procedural glyph exists for an id (used by tests / the snapshot fixture). */
export function hasIcon(id: SpriteId): boolean {
  return id in ICON_GRIDS;
}
