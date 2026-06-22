/**
 * Pickup sprites (docs/areas/11-art-visual-style.md §3.3). `pickup.ruble` is a small gold coin.
 * Legend: g=rubleGold, k=ink, l=flash(shine).
 */
import type { ArtEntry } from './types';
import type { SpriteId } from '../../content/sprite-ids';
import { mk, sprite } from './grid';

const ruble = mk(8, [
  ' gggg ',
  'gglggg',
  'gkggkg',
  'gkggkg',
  'gkggkg',
  'gkkggg',
  'gggggg',
  ' gggg ',
], { g: 'rubleGold', k: 'ink', l: 'flash' });

export const PICKUPS: Partial<Record<SpriteId, ArtEntry>> = {
  'pickup.ruble': sprite(ruble),
};
