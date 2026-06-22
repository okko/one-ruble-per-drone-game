/**
 * Meter / ruble icon grids (docs/areas/10-hud-ui.md §3.2, docs/areas/11-art-visual-style.md §3.4).
 * The single source of truth for the 8×8 need icons: the HUD draws them directly (`ui/hud/icons.ts`)
 * AND they are baked into the art atlas so `drawSprite('icon.*')` resolves real pixels behind the
 * same ids. Pixel-art, NOT OS emoji, so they are identical across engines (the §8.16 snapshot basis).
 */
import type { PixelGrid } from './types';

// Legend chars: b=blue n=brown(crust/pile) t=tan(bread) c=cream r=red s=smoke k=ink(eyes) g=gold
export const ICON_GRIDS: Record<string, PixelGrid> = {
  // 😴 — a bold blue "Z".
  'icon.sleep': {
    rows: ['bbbbbb  ', '    bb  ', '   bb   ', '  bb    ', ' bb     ', 'bbbbbb  ', '        ', '        '],
    legend: { b: 'panelLite' },
  },
  // 🍞 — a bread loaf (brown crust over a tan body).
  'icon.hunger': {
    rows: ['  nnnn  ', ' ntttn  ', 'ntttttn ', 'ntttttn ', 'ntttttn ', 'ntttttn ', ' nnnnnn ', '        '],
    legend: { n: 'skinDk', t: 'skin' },
  },
  // 💧 — a blue droplet.
  'icon.thirst': {
    rows: ['   b    ', '   b    ', '  bbb   ', '  bbb   ', ' bbbbb  ', ' bbbbb  ', '  bbb   ', '        '],
    legend: { b: 'panelLite' },
  },
  // 🚬 — a cigarette (cream stick, red ember, rising smoke).
  'icon.vice': {
    rows: ['     s  ', '    s   ', '     s  ', 'cccccr  ', 'cccccr  ', '        ', '        ', '        '],
    legend: { c: 'cream', r: 'meterCrit', s: 'smoke' },
  },
  // 💩 — a brown pile with two dark eyes (the only icon using ink, for unambiguous identification).
  'icon.poo': {
    rows: ['   nn   ', '  nnnn  ', '  nnnn  ', ' nnnnnn ', ' nknkn  ', 'nnnnnnnn', 'nnnnnnnn', '        '],
    legend: { n: 'skinDk', k: 'ink' },
  },
  // ₽ — a gold coin.
  'icon.ruble': {
    rows: ['  gggg  ', ' gggggg ', 'ggkkkgg ', 'ggkggkg ', 'ggkkkgg ', 'ggkgggg ', ' gggggg ', '  gggg  '],
    legend: { g: 'rubleGold', k: 'ink' },
  },
};
