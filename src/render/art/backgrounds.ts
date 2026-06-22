/**
 * Sky body sprites (docs/areas/11-art-visual-style.md §3.5). `bg.sun` / `bg.moon` (16×16) track the
 * day/night cycle, positioned by code. Legend: y=domeGold(sun), o=explOrange(rays), c=cream(moon),
 * s=concrete(crater).
 */
import type { ArtEntry } from './types';
import type { SpriteId } from '../../content/sprite-ids';
import { mk, sprite } from './grid';

const sun = mk(16, [
  '       o',
  '   o   o   o',
  '     yyyy',
  '    yyyyyy',
  '  o yyyyyy o',
  '    yyyyyy',
  '    yyyyyy',
  '   o yyyy o',
  '       o',
  '   o   o   o',
  '',
  '',
  '',
  '',
  '',
  '',
], { y: 'domeGold', o: 'explOrange' });

const moon = mk(16, [
  '',
  '     cccc',
  '    cccccc',
  '   ccsccccc',
  '   ccccccsc',
  '   cccsccccc',
  '   cccccccsc',
  '    cccscc',
  '     cccc',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
], { c: 'cloud', s: 'concrete' });

export const BACKGROUNDS: Partial<Record<SpriteId, ArtEntry>> = {
  'bg.sun': sprite(sun),
  'bg.moon': sprite(moon),
};
