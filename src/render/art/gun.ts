/**
 * Gun sprites (docs/areas/11-art-visual-style.md §3.3/§3.8). `gun.base` is a side-on machine gun that
 * the renderer rotates about its mount pivot [4,8]; `gun.flash` is a 3-frame muzzle burst
 * (flash→flashHot), ~30fps. Legend: o=outline, m=gunmetal, d=dark, l/h=flash/flashHot.
 */
import type { ArtEntry } from './types';
import type { SpriteId } from '../../content/sprite-ids';
import { mk, sprite, anim } from './grid';

const base = mk(28, [
  '',
  '',
  '        ooooo',
  '   ooooommmmmoo',
  '  ommmmmmmmmmmmoo',
  '  ommmmmmmmmmmmmmmmmmmmmmmlo',
  '  ommmmmmmmmmmmmmmmmmmmmmmlo',
  '  ommmmmmmmmmmmmmmmmmmmmmmlo',
  '  ommmmmmmmmmmmoo',
  '   ooooommmmmoo',
  '     dooooo',
  '     omo',
  '     omo',
  '      o',
  '',
  '',
], { o: 'ink', m: 'gunmetal', d: 'gunmetalDk', l: 'flashHot' });

const flash0 = mk(16, [
  '', '', '', '', '', '', '',
  '       ll',
  '      lhl',
  '       ll',
  '', '', '', '', '', '',
], { l: 'flash', h: 'flashHot' });

const flash1 = mk(16, [
  '', '', '',
  '       l',
  '      hh',
  '     lhhl',
  '    llhhhll',
  '  llhhHHHhhll',
  '    llhhhll',
  '     lhhl',
  '      hh',
  '       l',
  '', '', '', '',
], { l: 'flash', h: 'flashHot', H: 'cream' });

const flash2 = mk(16, [
  '', '',
  '   l   l   l',
  '    l  l  l',
  '     llhll',
  '   llhhhhhll',
  '  lhhhHHHhhhl',
  ' lhhHHHHHHHhhl',
  '  lhhhHHHhhhl',
  '   llhhhhhll',
  '     llhll',
  '    l  l  l',
  '   l   l   l',
  '', '', '',
], { l: 'flash', h: 'flashHot', H: 'cream' });

export const GUN: Partial<Record<SpriteId, ArtEntry>> = {
  'gun.base': sprite(base, [4, 8]),
  'gun.flash': anim([flash0, flash1, flash2], 30),
};
