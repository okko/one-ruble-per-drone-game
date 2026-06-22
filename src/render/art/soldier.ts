/**
 * Soldier-at-the-post sprites (docs/areas/11-art-visual-style.md §3.3). One 32×40 figure — ushanka,
 * face, green greatcoat — with four states that differ only in the eyes/mouth row: idle, fire
 * (gritted), tired (drowsy), crisis (wide-eyed + sweat). Center-bottom pivot (default). Legend:
 * o=ink, h=fur, H=band, s=skin, e=eye, m=mouth, u=uniform, d=uniformDk, b=button(gold), w=sweat.
 */
import type { ArtEntry } from './types';
import type { SpriteId } from '../../content/sprite-ids';
import { mkh, sprite } from './grid';

const FACE_ROW = 12; // index of the eyes row, overridden per state

const base: string[] = [
  '',
  '          oooooo',
  '        oohhhhhhoo',
  '       ohhhhhhhhhho',
  '      ohhhhhhhhhhhho',
  '      oHHHHHHHHHHHHo',
  '     oHHHHHHHHHHHHHHo',
  '     oHssssssssssssHo',
  '     ossssssssssssso',
  '     osssssssssssso',
  '      ssssssssssss',
  '      sssssssssss',
  '      seesssseess', // FACE_ROW (12) — eyes
  '      sssssssssss',
  '      ssssmmmmsss',
  '       sssssssss',
  '        ooooooo',
  '       uuuuuuuuu',
  '     oouuuuuuuuuuoo',
  '    ouuuuuuuuuuuuuuo',
  '   ouuuuuuubuuuuuuuuo',
  '   oduuuuuubuuuuuuduo',
  '   oduuuuuubuuuuuuduo',
  '   oduuuuuubuuuuuuduo',
  '   oduuuuuubuuuuuuduo',
  '   oduuuuuuuuuuuuuduo',
  '   odduuuuuuuuuuuuddo',
  '   odduuuuuuuuuuuuddo',
  '    oduuuuuuuuuuuudo',
  '    oduuuuuuuuuuuudo',
  '    oduuuuuuuuuuuudo',
  '    oouuuuuuuuuuuoo',
  '     ouuuuuuuuuuuo',
  '     ouuuuuuuuuuuo',
  '     oooooooooooo',
  '     oo        oo',
  '',
  '',
  '',
  '',
];

const LEGEND = {
  o: 'ink', h: 'cloud', H: 'concreteDk', s: 'skin', e: 'ink', m: 'skinDk',
  u: 'uniform', d: 'uniformDk', b: 'rubleGold', w: 'panelLite',
} as const;

function withFace(face: string): ArtEntry {
  const rows = base.slice();
  rows[FACE_ROW] = face;
  return sprite(mkh(32, 40, rows, LEGEND));
}

export const SOLDIER: Partial<Record<SpriteId, ArtEntry>> = {
  'soldier.idle': withFace('      seesssseess'),
  'soldier.fire': withFace('      seeessseees'),
  'soldier.tired': withFace('      sooosoooos'),
  'soldier.crisis': withFace('     wseeesseeesw'),
};
