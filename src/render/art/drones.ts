/**
 * Drone + decoy sprites (docs/areas/11-art-visual-style.md §3.3). Single-frame, type-distinct
 * silhouettes with a 1px `ink` outline and a per-type accent (the engine still bobs/moves them in
 * code). Legend: o=outline, b=body(gunmetal), e=ember/eye(red), and the type accent letter. Rows are
 * padded to the §3.3 size by `mk`; the engine `kind` → id mapping lives in `playing-scene`.
 */
import type { PixelGrid } from './types';
import { mk } from './grid';

// drone.scout 16×16 — fast quad, cyan accent.
const scout = mk(16, [
  '',
  '   o      o',
  '  ooo    ooo',
  '',
  '     oooooo',
  '    osssssso',
  '   ossssssso',
  '   ossbbbsso',
  '   ossbebsso',
  '   ossbbbsso',
  '   ossssssso',
  '    ossssso',
  '     oooooo',
  '      o  o',
  '',
  '',
], { o: 'ink', s: 'droneScout', b: 'droneBody', e: 'meterCrit' });

// drone.special 16×16 — flat single colour (code tints it per jackpot tag).
const special = mk(16, [
  '',
  '   o      o',
  '  ooo    ooo',
  '',
  '     oooooo',
  '    oaaaaaao',
  '   oaaaaaaao',
  '   oaaaaaaao',
  '   oaaoooaao',
  '   oaaaaaaao',
  '   oaaaaaaao',
  '    oaaaaao',
  '     oooooo',
  '      o  o',
  '',
  '',
], { o: 'ink', a: 'cream' });

// drone.swarm 12×12 — tiny, purple.
const swarm = mk(12, [
  '',
  '  o      o',
  '  oo    oo',
  '',
  '    oooo',
  '   owwwwo',
  '   owoowo',
  '   owwwwo',
  '    oooo',
  '     oo',
  '',
  '',
], { o: 'ink', w: 'droneSwarm' });

// drone.bomber 24×24 — slow, red, slung bomb.
const bomber = mk(24, [
  '',
  '    o              o',
  '   ooo            ooo',
  '',
  '       oooooooooo',
  '      ommmmmmmmmmo',
  '     ommmmmmmmmmmmo',
  '     ommbbbbbbbbmmo',
  '     ommbeeeeeebmmo',
  '     ommbbbbbbbbmmo',
  '     ommmmmmmmmmmmo',
  '      ommmmmmmmmmo',
  '       oooooooooo',
  '         oooo',
  '        obbbbo',
  '        obeebo',
  '        obbbbo',
  '         oooo',
  '          oo',
  '',
  '',
  '',
  '',
  '',
], { o: 'ink', m: 'droneBomber', b: 'droneBody', e: 'meterCrit' });

// drone.armored 24×20 — plated, needs 2+ hits.
const armored = mk(24, [
  '',
  '    o              o',
  '   ooo            ooo',
  '',
  '      oooooooooooo',
  '     oggoggoggoggo',
  '    oggbbggbbggbbggo',
  '    ogbbbbbbbbbbbbgo',
  '    ogbboooooooobbgo',
  '    ogbbollllllobbgo',
  '    ogbboooooooobbgo',
  '    ogbbbbbbbbbbbbgo',
  '    oggbbggbbggbbggo',
  '     oggoggoggoggo',
  '      oooooooooooo',
  '       o      o',
  '',
  '',
  '',
  '',
], { o: 'ink', g: 'concrete', b: 'concreteDk', l: 'flash' });

// drone.boss 48×48 — mega attacker, magenta.
const boss = mk(48, [
  '',
  '',
  '       o                              o',
  '      ooo                            ooo',
  '     ooooo                          ooooo',
  '       o                              o',
  '          oooooooooooooooooooooooo',
  '        oozzzzzzzzzzzzzzzzzzzzzzzzoo',
  '       ozzzzzzzzzzzzzzzzzzzzzzzzzzzzo',
  '      ozzzzzzzzzzzzzzzzzzzzzzzzzzzzzzo',
  '      ozzzzzbbbbbbbbbbbbbbbbbbzzzzzzo',
  '      ozzzzbbbbbbbbbbbbbbbbbbbbzzzzzo',
  '      ozzzzbboooooooooooooooobbzzzzo',
  '      ozzzzbbollllllllllllllobbzzzzo',
  '      ozzzzbbolleeeeeeeeeellobbzzzzo',
  '      ozzzzbbollllllllllllllobbzzzzo',
  '      ozzzzbboooooooooooooooobbzzzzo',
  '      ozzzzbbbbbbbbbbbbbbbbbbbbzzzzo',
  '      ozzzzzbbbbbbbbbbbbbbbbbbzzzzzo',
  '       ozzzzzzzzzzzzzzzzzzzzzzzzzzo',
  '        oozzzzzzzzzzzzzzzzzzzzzzoo',
  '          oooooozzzzzzzzzzoooooo',
  '               ozzzzzzzzzzo',
  '              ozzzzzzzzzzzzo',
  '             ozzzooooooozzzzo',
  '             ozzo      ozzzo',
  '              oo        oo',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
], { o: 'ink', z: 'droneBoss', b: 'droneBody', l: 'gunmetalDk', e: 'flash' });

// decoy.bird 16×12 — a bird (penalty if shot). Brown body, cream belly.
const bird = mk(16, [
  '',
  '    oo',
  '   onno    oo',
  '   onnno  onno',
  '    onnnoonnno',
  '  oonnnnnnnnno',
  ' onnnnnnnnnno',
  ' occcccnnno',
  '  oooooo o',
  '       o',
  '',
  '',
], { o: 'ink', n: 'skinDk', c: 'cream' });

export const DRONE_GRIDS: Record<string, PixelGrid> = {
  'drone.scout': scout,
  'drone.special': special,
  'drone.swarm': swarm,
  'drone.bomber': bomber,
  'drone.armored': armored,
  'drone.boss': boss,
  'decoy.bird': bird,
};
