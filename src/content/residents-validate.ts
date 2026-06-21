/**
 * Validators for the resident roster + economy tunables (docs/areas/03-economy-and-residents.md §5).
 * Asserts: unique resident ids, prices ≥ 1, reliefs reference valid meters and stay in range, every
 * favor has a valid consequence, minRelationship in [0,100]. Throws `ContentValidationError`.
 * Fields are checked in place; the final cast is sound because every field has been validated.
 */
import { ContentValidationError } from './content-error';
import { asArray, asObject, num, str, isFiniteNumber, oneOf } from './validate-helpers';
import { METER_KEYS } from '../types/meter-key';
import type { MeterKey } from '../types/meter-key';
import type { ResidentDef, EconomyTunables, ConsequenceKind } from './residents';

const CONSEQUENCE_KINDS: readonly ConsequenceKind[] = ['debt', 'chore', 'reputation', 'degraded'];

function validateMeter(v: unknown, path: string): MeterKey {
  return oneOf(v, METER_KEYS, path);
}

function validateReliefRequest(raw: unknown, path: string): void {
  const r = asObject(raw, path);
  validateMeter(r.meter, `${path}.meter`);
  num(r, 'amount', path, { min: 0, max: 100 });
  if (r.secondary !== undefined) {
    const s = asObject(r.secondary, `${path}.secondary`);
    validateMeter(s.meter, `${path}.secondary.meter`);
    num(s, 'amount', `${path}.secondary`, { min: -100, max: 100 }); // signed delta
  }
  if (r.effect !== undefined) oneOf(r.effect, ['drunk', 'coffee'] as const, `${path}.effect`);
}

function validateConsequence(raw: unknown, path: string): void {
  const c = asObject(raw, path);
  const kind = oneOf(c.kind, CONSEQUENCE_KINDS, `${path}.kind`);
  switch (kind) {
    case 'debt':
      num(c, 'amount', path, { min: 1 });
      return;
    case 'chore':
      num(c, 'durationSeconds', path, { min: 0.001 });
      return;
    case 'reputation':
      num(c, 'amount', path, { min: 1 });
      return;
    case 'degraded':
      num(c, 'reliefScale', path, { min: 0, max: 1 });
      if (c.sideEffect !== undefined) {
        const s = asObject(c.sideEffect, `${path}.sideEffect`);
        validateMeter(s.meter, `${path}.sideEffect.meter`);
        num(s, 'amount', `${path}.sideEffect`, { min: -100, max: 100 });
      }
      return;
  }
}

export function validateResidents(raw: unknown): ResidentDef[] {
  const roster = asArray(raw, 'content.residents');
  if (roster.length === 0) throw new ContentValidationError('roster is empty', 'content.residents');

  const seen = new Set<string>();
  roster.forEach((resRaw, i) => {
    const path = `content.residents[${i}]`;
    const res = asObject(resRaw, path);
    const id = str(res, 'id', path);
    if (seen.has(id)) throw new ContentValidationError(`duplicate resident id "${id}"`, path);
    seen.add(id);
    str(res, 'name', path);
    str(res, 'personality', path);
    num(res, 'floor', path, { int: true, min: 0 });

    const services = asArray(res.services, `${path}.services`);
    services.forEach((svcRaw, j) => {
      const sp = `${path}.services[${j}]`;
      const svc = asObject(svcRaw, sp);
      str(svc, 'id', sp);
      str(svc, 'label', sp);
      num(svc, 'basePrice', sp, { int: true, min: 1 });
      const tags = asArray(svc.tags, `${sp}.tags`);
      tags.forEach((t, k) => {
        if (typeof t !== 'string') throw new ContentValidationError('tag must be a string', `${sp}.tags[${k}]`);
      });
      if (svc.relief !== undefined) validateReliefRequest(svc.relief, `${sp}.relief`);
    });

    const favors = asArray(res.favors, `${path}.favors`);
    favors.forEach((favRaw, j) => {
      const fp = `${path}.favors[${j}]`;
      const fav = asObject(favRaw, fp);
      str(fav, 'id', fp);
      str(fav, 'label', fp);
      num(fav, 'minRelationship', fp, { min: 0, max: 100 });
      if (fav.relief !== undefined) validateReliefRequest(fav.relief, `${fp}.relief`);
      validateConsequence(fav.consequence, `${fp}.consequence`);
    });
  });

  return raw as ResidentDef[];
}

export function validateEconomyTunables(raw: unknown): EconomyTunables {
  const path = 'content.economy.tunables';
  const t = asObject(raw, path);
  for (const key of [
    'startingRelationship',
    'relationshipBaseline',
    'reputationBaseline',
    'refusalFloor',
    'qualityDivisor',
  ]) {
    num(t, key, path, { min: 0 });
  }
  for (const key of [
    'buyRelationshipGain',
    'buyReputationGain',
    'relationshipDriftPerSec',
    'reputationDriftPerSec',
    'debtClearReputationBonus',
  ]) {
    num(t, key, path, { min: 0 });
  }
  num(t, 'qualityMin', path, { min: 0, max: 1 });
  num(t, 'qualityMax', path, { min: 0, max: 1 });
  if (!isFiniteNumber(t.qualityMin) || !isFiniteNumber(t.qualityMax) || t.qualityMin > t.qualityMax) {
    throw new ContentValidationError('qualityMin must be ≤ qualityMax', path);
  }
  const pen = asObject(t.begPenalty, `${path}.begPenalty`);
  for (const kind of CONSEQUENCE_KINDS) {
    const p = asObject(pen[kind], `${path}.begPenalty.${kind}`);
    num(p, 'relationship', `${path}.begPenalty.${kind}`, { min: 0 });
    num(p, 'reputation', `${path}.begPenalty.${kind}`, { min: 0 });
  }
  return raw as EconomyTunables;
}
