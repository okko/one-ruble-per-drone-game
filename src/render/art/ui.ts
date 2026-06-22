/**
 * UI chrome sprites (docs/areas/11-art-visual-style.md §3.3). Cheerful blue panels + buttons and the
 * meter frame/fill (the fill is authored solid and tinted good/warn/crit in code). These back the
 * `ui.*` ids in the atlas for future use; the HUD/menus still draw their own rects today. Legend:
 * o=ink, p=panel, l=panelLite(highlight), d=shadow(press), c=cream(fill).
 */
import type { ArtEntry } from './types';
import type { SpriteId } from '../../content/sprite-ids';
import { mk, sprite } from './grid';

const panel = mk(16, [
  'oooooooooooooooo',
  'ollllllllllllllo',
  'olpppppppppppplo',
  'olpppppppppppplo',
  'olpppppppppppplo',
  'olpppppppppppplo',
  'olpppppppppppplo',
  'olpppppppppppplo',
  'olpppppppppppplo',
  'olpppppppppppplo',
  'olpppppppppppplo',
  'olpppppppppppplo',
  'olpppppppppppplo',
  'olpppppppppppplo',
  'oddddddddddddddo',
  'oooooooooooooooo',
], { o: 'ink', p: 'panel', l: 'panelLite', d: 'shadow' });

const corner = mk(8, [
  'ooooooo',
  'olllllo',
  'olppppo',
  'olppppo',
  'olppppo',
  'olppppo',
  'oppppoo',
  'oooooo',
], { o: 'ink', p: 'panel', l: 'panelLite' });

const meterFrame = mk(48, [
  'oooooooooooooooooooooooooooooooooooooooooooooooo',
  'o                                              o',
  'o                                              o',
  'o                                              o',
  'o                                              o',
  'o                                              o',
  'o                                              o',
  'oooooooooooooooooooooooooooooooooooooooooooooooo',
], { o: 'ink' });

const meterFill = mk(48, [
  '',
  ' cccccccccccccccccccccccccccccccccccccccccccc',
  ' cccccccccccccccccccccccccccccccccccccccccccc',
  ' cccccccccccccccccccccccccccccccccccccccccccc',
  ' cccccccccccccccccccccccccccccccccccccccccccc',
  ' cccccccccccccccccccccccccccccccccccccccccccc',
  ' cccccccccccccccccccccccccccccccccccccccccccc',
  '',
], { c: 'cream' });

const btn = (fill: 'panel' | 'panelLite' | 'shadow', topKey: 'panelLite' | 'cream' | 'panel') =>
  mk(32, [
    'oooooooooooooooooooooooooooooooo',
    'otttttttttttttttttttttttttttttto',
    'obbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbo',
    'obbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbo',
    'obbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbo',
    'obbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbo',
    'obbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbo',
    'obbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbo',
    'obbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbo',
    'obbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbo',
    'obbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbo',
    'obbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbo',
    'obbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbo',
    'obbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbo',
    'odddddddddddddddddddddddddddddddo',
    'oooooooooooooooooooooooooooooooo',
  ], { o: 'ink', t: topKey, b: fill, d: 'shadow' });

export const UI: Partial<Record<SpriteId, ArtEntry>> = {
  'ui.panel': sprite(panel),
  'ui.panel.corner': sprite(corner),
  'ui.meter.frame': sprite(meterFrame),
  'ui.meter.fill': sprite(meterFill),
  'ui.btn': sprite(btn('panel', 'panelLite')),
  'ui.btn.hover': sprite(btn('panelLite', 'cream')),
  'ui.btn.press': sprite(btn('shadow', 'panel')),
};
