/**
 * The art registry (docs/areas/11-art-visual-style.md §4). Maps `SpriteId`s to their pixel-art data.
 * Any id NOT present here falls through to the placeholder provider (so partial art still runs and a
 * human can finish a sprite later behind the same id). Assembled from one module per sprite group.
 */
import type { SpriteId } from '../../content/sprite-ids';
import type { ArtEntry, PixelGrid } from './types';
import { ICON_GRIDS } from './icons';
import { DRONE_GRIDS } from './drones';
import { GUN } from './gun';
import { FX } from './fx';
import { PICKUPS } from './pickups';
import { BACKGROUNDS } from './backgrounds';
import { UI } from './ui';
import { SOLDIER } from './soldier';
import { FONT_5x7 } from './fonts';

function spriteFromGrid(grid: PixelGrid): ArtEntry {
  const h = grid.rows.length;
  const w = grid.rows[0]?.length ?? 0;
  return { kind: 'sprite', w, h, frames: [grid] };
}

function gridsToEntries(grids: Record<string, PixelGrid>): Partial<Record<SpriteId, ArtEntry>> {
  const out: Partial<Record<SpriteId, ArtEntry>> = {};
  for (const [id, grid] of Object.entries(grids)) out[id as SpriteId] = spriteFromGrid(grid);
  return out;
}

const icons = gridsToEntries(ICON_GRIDS);
const drones = gridsToEntries(DRONE_GRIDS);

// The 5×7 face backs both font ids (a distinct 8×8 display face is future polish).
const font: ArtEntry = { kind: 'font', ...FONT_5x7 };

export const ART: Partial<Record<SpriteId, ArtEntry>> = {
  ...icons,
  ...drones,
  ...GUN,
  ...FX,
  ...PICKUPS,
  ...BACKGROUNDS,
  ...UI,
  ...SOLDIER,
  'font.hud': font,
  'font.display': font,
};

