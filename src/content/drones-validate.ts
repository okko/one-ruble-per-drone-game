/**
 * Validator for the drone catalog (docs/areas/01-gameplay-engine.md §5). Confirms unique kinds, a
 * known sprite id, sane stats, a legal movement archetype, and that `weightAtD` is a function
 * returning a finite non-negative weight. (Catalog entries hold a function, so the value passes
 * through unchanged.) The `kind ∈ scoringBalance.basePoints` cross-check lives in an integration test
 * to avoid coupling this validator to the scoring table. Throws `ContentValidationError`.
 */
import { ContentValidationError } from './content-error';
import { asArray, asObject, num, str, isFiniteNumber, oneOf } from './validate-helpers';
import { isKnownSpriteId } from './sprite-ids';
import type { DroneDef } from './drones';
import type { MovementKind } from '../state/game-state';

const MOVEMENTS: readonly MovementKind[] = ['straight', 'zigzag', 'kamikaze', 'wander', 'boss'];

export function validateDrones(raw: unknown): DroneDef[] {
  const catalog = asArray(raw, 'content.drones');
  if (catalog.length === 0) {
    throw new ContentValidationError('drone catalog is empty', 'content.drones');
  }
  const seen = new Set<string>();
  catalog.forEach((defRaw, i) => {
    const path = `content.drones[${i}]`;
    const def = asObject(defRaw, path);
    const kind = str(def, 'kind', path);
    if (seen.has(kind)) throw new ContentValidationError(`duplicate drone kind "${kind}"`, path);
    seen.add(kind);

    const spriteId = str(def, 'spriteId', path);
    if (!isKnownSpriteId(spriteId)) {
      throw new ContentValidationError(`unknown spriteId "${spriteId}"`, `${path}.spriteId`);
    }

    num(def, 'baseHp', path, { min: 1 });
    num(def, 'baseSpeed', path, { min: 0 });
    num(def, 'radius', path, { min: 0.001 });
    num(def, 'escapeDamage', path, { min: 0 });
    if (typeof def.awardsRuble !== 'boolean') {
      throw new ContentValidationError('awardsRuble must be a boolean', path);
    }
    oneOf(def.movement, MOVEMENTS, `${path}.movement`);
    num(def, 'unlockD', path, { min: 0 });

    if (typeof def.weightAtD !== 'function') {
      throw new ContentValidationError('weightAtD must be a function', path);
    }
    for (const D of [0, 5, 12]) {
      const w = (def.weightAtD as (d: number) => number)(D);
      if (!isFiniteNumber(w) || w < 0) {
        throw new ContentValidationError(`weightAtD(${D}) must be a number ≥ 0`, path);
      }
    }
  });
  return raw as DroneDef[];
}
