/**
 * Effect sprites (docs/areas/11-art-visual-style.md §3.3/§3.8). `fx.explosion` is a 5-frame expanding
 * burst (yellow→orange→smoke, ~20fps), each frame a full 32×32 (height-safe via `mkh`, roughly
 * centred); tracer/spark/drip are tiny single frames. Legend: y=explYellow, n=explOrange, s=smoke,
 * H=cream(core), l=flash, b=panelLite(water).
 */
import type { ArtEntry } from './types';
import type { SpriteId } from '../../content/sprite-ids';
import { mk, mkh, sprite, anim } from './grid';

const tracer = mk(4, ['', ' ll', ' ll', ''], { l: 'flash' });
const spark = mk(8, ['', '  l  l', '   ll', '  llll', '   ll', '  l  l', '', ''], { l: 'flash' });
const drip = mk(8, ['', '   b', '   b', '  bbb', '  bbb', ' bbbbb', '  bbb', ''], { b: 'panelLite' });

const lead = (n: number): string[] => Array.from({ length: n }, () => '');
const EXP = { y: 'explYellow', n: 'explOrange', s: 'smoke', H: 'cream' } as const;
const ex = (top: number, rows: string[]) => mkh(32, 32, [...lead(top), ...rows], EXP);

const e0 = ex(14, ['     yy', '    yyyy', '    yyyy', '     yy']);
const e1 = ex(12, ['     nnnn', '    nyyyyn', '    nyyyyn', '    nyyyyn', '     nnnn']);
const e2 = ex(10, [
  '      nnnnnn',
  '    nnyyyyyynn',
  '   nyyyyHHyyyyn',
  '   nyyyyHHyyyyn',
  '    nnyyyyyynn',
  '      nnnnnn',
]);
const e3 = ex(8, [
  '    ssnnnnnnnnss',
  '   snnyyyyyyyynns',
  '  snyyyyHHHHyyyyns',
  '  snyyynnHHnnyyyns',
  '  snyyyyHHHHyyyyns',
  '   snnyyyyyyyynns',
  '    ssnnnnnnnnss',
]);
const e4 = ex(7, [
  '   s s    s   s',
  '  s ssnn nnss s',
  ' s  snnssssnns  s',
  '    snsy  ysns',
  ' s  ssn s s nss s',
  '  s  snnssssnns s',
  '   s s ssnnss s s',
  '      ss s s ss',
]);

export const FX: Partial<Record<SpriteId, ArtEntry>> = {
  'fx.tracer': sprite(tracer),
  'fx.spark': sprite(spark),
  'fx.drip': sprite(drip),
  'fx.explosion': anim([e0, e1, e2, e3, e4], 20),
};
