import { describe, it, expect } from 'vitest';
import { validateResidents, validateEconomyTunables } from './residents-validate';
import { RESIDENTS, ECONOMY_TUNABLES } from './residents';
import type { ResidentDef } from './residents';
import { ContentValidationError } from './content-error';

/** A valid baseline resident; tests pass deliberately-broken literals to the (unknown) validator. */
function validResident(over: Partial<ResidentDef> = {}): ResidentDef {
  return {
    id: 'r1',
    name: 'Resident One',
    floor: 1,
    personality: 'a fixture',
    services: [{ id: 's1', label: 'A Service', basePrice: 2, tags: [], relief: { meter: 'hunger', amount: 30 } }],
    favors: [
      { id: 'f1', label: 'A Favor', minRelationship: 20, relief: { meter: 'vice', amount: 30 }, consequence: { kind: 'debt', amount: 5 } },
    ],
    ...over,
  };
}

describe('validateResidents', () => {
  it('accepts the shipped roster', () => {
    expect(validateResidents(RESIDENTS)).toBe(RESIDENTS);
    expect(validateResidents([validResident()])).toHaveLength(1);
  });

  it('rejects a non-array and an empty roster', () => {
    expect(() => validateResidents({})).toThrow(ContentValidationError);
    expect(() => validateResidents([])).toThrow(/empty/);
  });

  it('rejects duplicate resident ids', () => {
    expect(() => validateResidents([validResident({ id: 'x' }), validResident({ id: 'x' })])).toThrow(
      /duplicate resident id/,
    );
  });

  it('rejects a service priced below 1', () => {
    const bad = [{ ...validResident(), services: [{ id: 's', label: 'S', basePrice: 0, tags: [], relief: { meter: 'hunger', amount: 1 } }] }];
    expect(() => validateResidents(bad)).toThrow(/basePrice must be ≥ 1/);
  });

  it('rejects a relief referencing an unknown meter', () => {
    const bad = [{ ...validResident(), services: [{ id: 's', label: 'S', basePrice: 1, tags: [], relief: { meter: 'morale', amount: 10 } }] }];
    expect(() => validateResidents(bad)).toThrow(/meter/);
  });

  it('rejects a relief amount above 100', () => {
    const bad = [{ ...validResident(), services: [{ id: 's', label: 'S', basePrice: 1, tags: [], relief: { meter: 'hunger', amount: 150 } }] }];
    expect(() => validateResidents(bad)).toThrow(/amount must be ≤ 100/);
  });

  it('rejects a non-string service tag', () => {
    const bad = [{ ...validResident(), services: [{ id: 's', label: 'S', basePrice: 1, tags: [7] }] }];
    expect(() => validateResidents(bad)).toThrow(/tag must be a string/);
  });

  it('rejects a favor with an invalid consequence kind', () => {
    const bad = [{ ...validResident(), favors: [{ id: 'f', label: 'F', minRelationship: 0, consequence: { kind: 'curse' } }] }];
    expect(() => validateResidents(bad)).toThrow(/kind/);
  });

  it('rejects a minRelationship out of range', () => {
    const bad = [{ ...validResident(), favors: [{ id: 'f', label: 'F', minRelationship: 200, consequence: { kind: 'debt', amount: 1 } }] }];
    expect(() => validateResidents(bad)).toThrow(/minRelationship/);
  });

  it('rejects a degraded reliefScale outside [0,1]', () => {
    const bad = [{ ...validResident(), favors: [{ id: 'f', label: 'F', minRelationship: 0, consequence: { kind: 'degraded', reliefScale: 2 } }] }];
    expect(() => validateResidents(bad)).toThrow(/reliefScale/);
  });

  it('rejects a chore with a non-positive duration', () => {
    const bad = [{ ...validResident(), favors: [{ id: 'f', label: 'F', minRelationship: 0, consequence: { kind: 'chore', durationSeconds: 0 } }] }];
    expect(() => validateResidents(bad)).toThrow(/durationSeconds/);
  });
});

describe('validateEconomyTunables', () => {
  it('accepts the shipped tunables', () => {
    expect(validateEconomyTunables(ECONOMY_TUNABLES)).toBe(ECONOMY_TUNABLES);
  });

  it('rejects qualityMin greater than qualityMax', () => {
    expect(() => validateEconomyTunables({ ...ECONOMY_TUNABLES, qualityMin: 0.9, qualityMax: 0.5 })).toThrow(
      /qualityMin must be ≤ qualityMax/,
    );
  });

  it('rejects a missing begPenalty kind', () => {
    const { begPenalty } = ECONOMY_TUNABLES;
    const partial = { debt: begPenalty.debt, reputation: begPenalty.reputation, degraded: begPenalty.degraded };
    expect(() => validateEconomyTunables({ ...ECONOMY_TUNABLES, begPenalty: partial })).toThrow(/begPenalty.chore/);
  });

  it('rejects a non-numeric tunable', () => {
    expect(() => validateEconomyTunables({ ...ECONOMY_TUNABLES, refusalFloor: 'low' })).toThrow(/must be a number/);
  });
});
