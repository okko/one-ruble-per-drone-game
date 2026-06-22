/**
 * Validator for the combat balance table (docs/areas/01-gameplay-engine.md §5). Confirms the gun /
 * spawn / projectile / scaling / difficulty constants are finite and sanely ordered (e.g.
 * minInterval ≤ baseInterval, cooloffResume < 100), so malformed tuning fails loudly at boot rather
 * than producing a broken run. Throws `ContentValidationError` with a locating path.
 */
import { ContentValidationError } from './content-error';
import { asObject, num } from './validate-helpers';
import type { CombatBalance } from './balance';

function vec2(obj: Record<string, unknown>, key: string, path: string): void {
  const v = asObject(obj[key], `${path}.${key}`);
  num(v, 'x', `${path}.${key}`);
  num(v, 'y', `${path}.${key}`);
}

export function validateCombatBalance(raw: unknown): CombatBalance {
  const path = 'content.combat';
  const root = asObject(raw, path);

  const arena = asObject(root.arena, `${path}.arena`);
  num(arena, 'width', `${path}.arena`, { min: 1 });
  num(arena, 'height', `${path}.arena`, { min: 1 });
  vec2(root, 'postTarget', path);
  num(root, 'escapeRadius', path, { min: 0 });
  num(root, 'postIntegrityMax', path, { min: 1 });

  const gun = asObject(root.gun, `${path}.gun`);
  vec2(gun, 'pivot', `${path}.gun`);
  num(gun, 'turnRate', `${path}.gun`, { min: 0 });
  num(gun, 'fireRate', `${path}.gun`, { min: 0.001 });
  num(gun, 'heatPerShot', `${path}.gun`, { min: 0 });
  num(gun, 'coolRate', `${path}.gun`, { min: 0 });
  const cooloffResume = num(gun, 'cooloffResume', `${path}.gun`, { min: 0, max: 100 });
  if (cooloffResume >= 100) {
    throw new ContentValidationError('gun.cooloffResume must be < 100 (else overheat never clears)', `${path}.gun`);
  }
  num(gun, 'jamClearPerInput', `${path}.gun`, { min: 0.001 });
  num(gun, 'jamClearThreshold', `${path}.gun`, { min: 0.001 });

  const aim = asObject(root.aim, `${path}.aim`);
  num(aim, 'swayFrequencyHz', `${path}.aim`, { min: 0 });
  num(aim, 'drunkFrequencyHz', `${path}.aim`, { min: 0 });
  num(aim, 'swayRadPerUnit', `${path}.aim`, { min: 0 });
  num(aim, 'drunkWobbleRad', `${path}.aim`, { min: 0 });

  const proj = asObject(root.projectile, `${path}.projectile`);
  num(proj, 'speed', `${path}.projectile`, { min: 0.001 });
  num(proj, 'ttl', `${path}.projectile`, { min: 0.001 });
  num(proj, 'radius', `${path}.projectile`, { min: 0 });
  num(proj, 'cap', `${path}.projectile`, { int: true, min: 1 });
  if (typeof proj.hitscan !== 'boolean') {
    throw new ContentValidationError('projectile.hitscan must be a boolean', `${path}.projectile`);
  }

  const spawn = asObject(root.spawn, `${path}.spawn`);
  const baseInterval = num(spawn, 'baseInterval', `${path}.spawn`, { min: 0.001 });
  const minInterval = num(spawn, 'minInterval', `${path}.spawn`, { min: 0.001 });
  if (minInterval > baseInterval) {
    throw new ContentValidationError('spawn.minInterval must be ≤ baseInterval', `${path}.spawn`);
  }
  num(spawn, 'dSoftcap', `${path}.spawn`, { min: 0.001 });
  num(spawn, 'jitter', `${path}.spawn`, { min: 0, max: 1 });
  const baseConcurrent = num(spawn, 'baseConcurrent', `${path}.spawn`, { int: true, min: 1 });
  num(spawn, 'concurrentPerD', `${path}.spawn`, { min: 0 });
  const maxConcurrent = num(spawn, 'maxConcurrent', `${path}.spawn`, { int: true, min: 1 });
  if (maxConcurrent < baseConcurrent) {
    throw new ContentValidationError('spawn.maxConcurrent must be ≥ baseConcurrent', `${path}.spawn`);
  }

  const scaling = asObject(root.scaling, `${path}.scaling`);
  num(scaling, 'speedPerD', `${path}.scaling`, { min: 0 });
  num(scaling, 'hpPerD', `${path}.scaling`, { min: 0 });

  const diff = asObject(root.difficulty, `${path}.difficulty`);
  num(diff, 'rampSeconds', `${path}.difficulty`, { min: 0.001 });
  num(diff, 'maxD', `${path}.difficulty`, { min: 0 });
  num(diff, 'dayLengthSeconds', `${path}.difficulty`, { min: 0.001 });

  return raw as CombatBalance;
}
