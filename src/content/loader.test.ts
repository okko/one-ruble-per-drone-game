import { describe, it, expect } from 'vitest';
import { loadContent } from './loader';

describe('loadContent', () => {
  it('loads and validates every table into the typed Content aggregate', () => {
    const content = loadContent();
    expect(content.drones.length).toBeGreaterThan(0);
    expect(content.economy.roster.length).toBeGreaterThan(0);
    expect(content.incidents.catalog.length).toBeGreaterThan(0);
    expect(content.combat.postIntegrityMax).toBeGreaterThan(0);
    expect(Object.keys(content.meters.warn).length).toBe(5);
    expect(content.scoring).toBeDefined();
    expect(content.audio).toBeDefined();
  });

  it('is a pure read: two loads produce equal aggregates', () => {
    // The loader takes no input, so the only way it could differ between calls is by mutating a
    // shared table on the way through — which is exactly what this pins down.
    expect(loadContent()).toEqual(loadContent());
  });
});
